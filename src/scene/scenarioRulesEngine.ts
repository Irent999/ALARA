/**
 * ALARA-Planner Pro VR — Движок правил, предупреждений 80% и условий проигрыша (ScenarioRulesEngine)
 *
 * Архитектурные гарантии:
 * 1. Триггеры сбоя (Fail Conditions):
 *    - Превышение H_limit: накопленная эквивалентная доза H_accum(t) >= H_limit сценария.
 *    - Таймаут T_max: время пребывания в зоне / выполнения задачи t >= T_max сценария.
 *    - Нарушение СИЗ / Техники безопасности: вход в опасную зону без требуемых СИЗ,
 *      захват радиоактивного источника голыми руками без дистанционного манипулятора
 *      или сближение с высокоактивным источником без защитного экрана.
 * 2. Система предупреждений (80% порога):
 *    - При достижении 80% от H_limit или T_max активируется флаг isWarning80Active:
 *      включается пульсирующий желтый оверлей на HUD, учащается треск дозиметра (множитель частоты 2.25×)
 *      и подается предупреждающий тактильный виброимпульс на контроллеры WebXR.
 * 3. Экран провала (Scenario Failed Modal) и заморозка перемещения:
 *    - При наступлении любого условия проигрыша мгновенно блокируется перемещение (isMovementFrozen = true),
 *      формируется детальная карточка провала с контекстной причиной по регламенту сценария
 *      и запускается 5-секундный обратный отсчет до автоматического вызова resetScenario().
 * 4. Полный сброс сценария (resetScenario()):
 *    - Возврат playerGroup в исходную точку спавна (initialSpawnPos).
 *    - Обнуление накопленной дозы (H_accum = 0), очистка графиков D(t) и H(t), CSV-буфера и голосового журнала.
 *    - Возврат всех 3D-объектов, СИЗ, защитных экранов, вентилей и приборов в начальные мировые координаты.
 */

import * as THREE from 'three';
import {
  IScenarioConfig,
  ScenarioFailCode,
  getScenarioConfigById
} from './scenarioConfigRegistry';
import {
  PPELoadoutId,
  RemoteToolId,
  ShieldMaterialType,
  PPE_LOADOUTS,
  REMOTE_TOOLS
} from '../physics/gostPhysics';
import {
  RadiationSourceInstance,
  ShieldingInstance,
  InteractiveObjectInstance
} from './scenarios';

export interface ScenarioRuntimeTelemetry {
  scenarioId: number;
  elapsedSec: number;
  cumulativeDoseMsv: number;
  currentDoseRateMicroSv: number;
  distanceToNearestSourceM: number;
  ppeLoadoutId: PPELoadoutId;
  remoteToolId: RemoteToolId;
  kShield: number;
  activeShieldMaterialRu: string;
  isHoldingRadioactiveSource: boolean;
  isSourceEnclosedInContainer: boolean;
  permitLimitMsv?: number;
}

export interface ScenarioFailedState {
  isFailed: boolean;
  failCode: ScenarioFailCode;
  titleRu: string;
  reasonRu: string;
  normativeRu: string;
  scenarioTitleRu: string;
  failedAtSec: number;
  finalDoseMsv: number;
  hLimitMsv: number;
  tMaxSec: number;
  violatedItemSummaryRu: string;
  countdownSec: number;
}

export interface ScenarioRulesEvaluationResult {
  config: IScenarioConfig;
  isFailed: boolean;
  isMovementFrozen: boolean;
  isWarning80Active: boolean;
  warning80Type: 'none' | 'dose' | 'time' | 'both' | 'safety_near_miss';
  warning80MessageRu: string | null;
  doseProgressRatio: number;
  timeProgressRatio: number;
  audioCrackleMultiplier: number;
  failState: ScenarioFailedState | null;

  // Динамические пороговые зоны и окно экстренного отступления (Retreat Grace Period)
  zoneAlertLevel: 'green' | 'yellow' | 'red_retreat';
  isRetreatCountdownActive: boolean;
  retreatCountdownRemainingSec: number;
  retreatAlertMessageRu: string | null;
}

interface InitialObjectTransformSnapshot {
  object: THREE.Object3D;
  parent: THREE.Object3D | null;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  visible: boolean;
}

interface InitialSourceSnapshot {
  source: RadiationSourceInstance;
  activityMBq: number;
  position: THREE.Vector3;
  enclosedInShield?: {
    material: ShieldMaterialType;
    thicknessCm: number;
  };
}

export interface ScenarioRulesEngineCallbacks {
  onWarning80Triggered?: (messageRu: string, doseRatio: number, timeRatio: number) => void;
  onWarning80HapticPulse?: () => void;
  onScenarioFailed?: (failState: ScenarioFailedState) => void;
  onResetScenarioConfirmed?: (config: IScenarioConfig) => void;
}

export class ScenarioRulesEngine {
  private currentConfig: IScenarioConfig;
  private readonly callbacks: ScenarioRulesEngineCallbacks;

  public isFailed = false;
  public isMovementFrozen = false;
  public isWarning80Active = false;
  public failState: ScenarioFailedState | null = null;

  // Динамические пороговые зоны и окно экстренного отступления (5-10 секунд)
  public retreatGraceRemainingSec = 8.0;
  public isRetreatGraceActive = false;
  public retreatGraceReasonRu: string | null = null;
  public zoneAlertLevel: 'green' | 'yellow' | 'red_retreat' = 'green';

  // Внутренние таймеры накопления нарушения ТБ и кулдауна предупреждений
  private ppeViolationExposureSec = 0;
  private proximityViolationExposureSec = 0;
  private warning80Notified = false;
  private lastWarningHapticTimeMs = 0;
  private readonly WARNING_HAPTIC_INTERVAL_MS = 950;

  // Снимки начальных мировых/локальных координат 3D-объектов сцены для точного возврата при resetScenario()
  private initialObjectSnapshots: InitialObjectTransformSnapshot[] = [];
  private initialSourceSnapshots: InitialSourceSnapshot[] = [];
  private trackedInteractiveItems: InteractiveObjectInstance[] = [];

  constructor(initialScenarioId = 1, callbacks: ScenarioRulesEngineCallbacks = {}) {
    this.currentConfig = getScenarioConfigById(initialScenarioId);
    this.callbacks = callbacks;
  }

  public getConfig(): IScenarioConfig {
    return this.currentConfig;
  }

  /**
   * Загрузка конфигурации нового сценария и сохранение начальных мировых координат всех 3D-объектов
   */
  public bindScenario(
    scenarioId: number,
    sceneObjects?: {
      sources: RadiationSourceInstance[];
      shields: ShieldingInstance[];
      interactive: InteractiveObjectInstance[];
    }
  ): IScenarioConfig {
    this.currentConfig = getScenarioConfigById(scenarioId);
    this.clearRuntimeFlags();

    if (sceneObjects) {
      this.captureInitialSceneSnapshot(
        sceneObjects.sources,
        sceneObjects.shields,
        sceneObjects.interactive
      );
    }

    return this.currentConfig;
  }

  /**
   * Фиксация эталонных начальных координат всех 3D-объектов, источников, экранов и приборов
   */
  public captureInitialSceneSnapshot(
    sources: RadiationSourceInstance[],
    shields: ShieldingInstance[],
    interactive: InteractiveObjectInstance[]
  ): void {
    this.initialObjectSnapshots = [];
    this.initialSourceSnapshots = [];
    this.trackedInteractiveItems = interactive;

    const seenMeshes = new Set<THREE.Object3D>();
    const registerMesh = (mesh?: THREE.Object3D) => {
      if (!mesh || seenMeshes.has(mesh)) return;
      seenMeshes.add(mesh);
      this.initialObjectSnapshots.push({
        object: mesh,
        parent: mesh.parent,
        position: mesh.position.clone(),
        quaternion: mesh.quaternion.clone(),
        scale: mesh.scale.clone(),
        visible: mesh.visible
      });
    };

    sources.forEach(src => {
      this.initialSourceSnapshots.push({
        source: src,
        activityMBq: src.activityMBq,
        position: src.position.clone(),
        enclosedInShield: src.enclosedInShield ? { ...src.enclosedInShield } : undefined
      });
      registerMesh(src.mesh);
    });

    shields.forEach(sh => {
      registerMesh(sh.mesh);
    });

    interactive.forEach(item => {
      registerMesh(item.mesh);
    });
  }

  /**
   * Восстановление всех 3D-объектов, источников и защитных экранов в их начальные координаты
   */
  public restoreSceneObjectsToInitialState(): void {
    this.initialObjectSnapshots.forEach(snap => {
      if (snap.parent && snap.object.parent !== snap.parent) {
        snap.parent.add(snap.object);
      }
      snap.object.position.copy(snap.position);
      snap.object.quaternion.copy(snap.quaternion);
      snap.object.scale.copy(snap.scale);
      snap.object.visible = snap.visible;
      snap.object.updateMatrixWorld(true);
    });

    this.initialSourceSnapshots.forEach(snap => {
      snap.source.activityMBq = snap.activityMBq;
      snap.source.position.copy(snap.position);
      snap.source.enclosedInShield = snap.enclosedInShield
        ? { ...snap.enclosedInShield }
        : undefined;
    });

    this.trackedInteractiveItems.forEach(item => {
      item.interacted = false;
      item.highlighted = false;
    });
  }

  private clearRuntimeFlags(): void {
    this.isFailed = false;
    this.isMovementFrozen = false;
    this.isWarning80Active = false;
    this.failState = null;
    this.ppeViolationExposureSec = 0;
    this.proximityViolationExposureSec = 0;
    this.warning80Notified = false;
    this.retreatGraceRemainingSec = 8.0;
    this.isRetreatGraceActive = false;
    this.retreatGraceReasonRu = null;
    this.zoneAlertLevel = 'green';
  }

  /**
   * Полный сброс сценария (resetScenario()):
   * - Возвращает 3D-объекты, источники и экраны в начальные координаты
   * - Сбрасывает состояние провала и размораживает управление
   * - Вызывает коллбэк полного сброса в App (возврат playerGroup в точку спавна,
   *   обнуление H_accum = 0, очистка графиков D(t) и H(t), CSV-буфера и голосового журнала)
   */
  public resetScenario(): void {
    this.restoreSceneObjectsToInitialState();
    this.clearRuntimeFlags();
    this.callbacks.onResetScenarioConfirmed?.(this.currentConfig);
  }

  /**
   * Ручной вызов контекстной ошибки регламента / сертификации (например, выдача ошибочного сертификата
   * на стройматериалы Ra-226 > 370 Бк/кг или ложное срабатывание на гранит в метрополитене)
   */
  public triggerProtocolViolation(
    telemetry: ScenarioRuntimeTelemetry,
    customReasonRu?: string
  ): ScenarioFailedState {
    const cfg = this.currentConfig;
    return this.enterFailedState(
      'PROTOCOL_CERTIFICATION_ERROR',
      'НАРУШЕНИЕ РЕГЛАМЕНТА РАДИАЦИОННОГО КОНТРОЛЯ',
      customReasonRu || cfg.failMessagesRu.protocolError,
      `Сценарий #${cfg.scenarioId}: Ошибка классификации / сертификации`,
      telemetry
    );
  }

  /**
   * Пошаговая проверка условий проигрыша, порога 80% и 5-секундного таймера перезапуска в цикле рендеринга
   */
  public evaluateStep(
    telemetry: ScenarioRuntimeTelemetry,
    dt: number
  ): ScenarioRulesEvaluationResult {
    if (telemetry.scenarioId !== this.currentConfig.scenarioId) {
      this.currentConfig = getScenarioConfigById(telemetry.scenarioId);
      this.clearRuntimeFlags();
    }

    const cfg = this.currentConfig;
    const doseRatio = cfg.hLimitMsv > 0 ? telemetry.cumulativeDoseMsv / cfg.hLimitMsv : 0;
    const timeRatio = cfg.tMaxSec > 0 ? telemetry.elapsedSec / cfg.tMaxSec : 0;

    // 1. Если сценарий уже находится в состоянии провала (Game Over) — ведем 5-секундный обратный отсчет
    if (this.isFailed && this.failState) {
      this.failState.countdownSec = Math.max(0, this.failState.countdownSec - dt);
      if (this.failState.countdownSec <= 0) {
        this.resetScenario();
        return {
          config: cfg,
          isFailed: false,
          isMovementFrozen: false,
          isWarning80Active: false,
          warning80Type: 'none',
          warning80MessageRu: null,
          doseProgressRatio: 0,
          timeProgressRatio: 0,
          audioCrackleMultiplier: 1.0,
          failState: null,
          zoneAlertLevel: 'green',
          isRetreatCountdownActive: false,
          retreatCountdownRemainingSec: 8.0,
          retreatAlertMessageRu: null
        };
      }

      return {
        config: cfg,
        isFailed: true,
        isMovementFrozen: true,
        isWarning80Active: true,
        warning80Type: 'both',
        warning80MessageRu: this.failState.reasonRu,
        doseProgressRatio: Math.min(1.5, doseRatio),
        timeProgressRatio: Math.min(1.5, timeRatio),
        audioCrackleMultiplier: 2.6,
        failState: { ...this.failState },
        zoneAlertLevel: 'red_retreat',
        isRetreatCountdownActive: false,
        retreatCountdownRemainingSec: 0,
        retreatAlertMessageRu: this.failState.reasonRu
      };
    }

    // ========================================================================
    // 2. ПРОВЕРКА ДИНАМИЧЕСКИХ ПОРОГОВ И КРИТИЧЕСКИХ ЗОН ОПАСНОСТИ
    // ========================================================================
    const effectiveHLimit =
      telemetry.permitLimitMsv && telemetry.permitLimitMsv > 0
        ? Math.min(cfg.hLimitMsv, telemetry.permitLimitMsv)
        : cfg.hLimitMsv;

    // Таймаут нормативного времени выполнения сценария T_max (t >= T_max)
    if (telemetry.elapsedSec >= cfg.tMaxSec && cfg.tMaxSec > 0) {
      const fail = this.enterFailedState(
        'TIMEOUT_EXCEEDED',
        'ВРЕМЯ МИССИИ ИСТЕКЛО',
        `Нормативное время выполнения лабораторного сценария истекло (${cfg.tMaxSec} с) до выполнения всех шагов чек-листа! Сработал нормативный лимит времени пребывания в радиационной зоне (Защита временем).`,
        `Время выполнения ${telemetry.elapsedSec.toFixed(1)} с превысило норматив T_max = ${cfg.tMaxSec} с`,
        telemetry
      );
      return this.buildFailedEvaluationResult(cfg, fail, doseRatio, timeRatio);
    }

    // Анализ критических факторов для запуска Окна Отступления (5-10 секунд):
    // 1) Превышение 95% от предела дозы наряда-допуска
    const isCriticalDose = effectiveHLimit > 0 && telemetry.cumulativeDoseMsv >= effectiveHLimit * 0.95;

    // 2) Вход в зону источника без требуемых СИЗ
    const isPpeAllowed = cfg.safetyRules.allowedPpeIds.includes(telemetry.ppeLoadoutId);
    const isInsidePpeZone =
      telemetry.distanceToNearestSourceM <= cfg.safetyRules.ppeEnforcementRadiusM &&
      !telemetry.isSourceEnclosedInContainer;
    const isPpeBreach = !isPpeAllowed && (isInsidePpeZone || telemetry.isHoldingRadioactiveSource);

    // 3) Захват горячего образца без дистанционного манипулятора
    const isGrabWithoutTool =
      telemetry.isHoldingRadioactiveSource &&
      cfg.safetyRules.requireRemoteToolOnSourceGrab &&
      !cfg.safetyRules.allowedRemoteToolsOnGrab.includes(telemetry.remoteToolId);

    // 4) Сближение в упор с открытым неэкранированным источником без защитного экрана
    const isUnshieldedCriticalProximity =
      cfg.safetyRules.requireShieldOrLeadPpeNearSource &&
      !telemetry.isSourceEnclosedInContainer &&
      telemetry.distanceToNearestSourceM <= cfg.safetyRules.criticalProximityRadiusM &&
      telemetry.kShield < 1.15 &&
      telemetry.ppeLoadoutId !== 'pneumosuit_lead';

    // 5) Экстремальная мощность дозы в точке нахождения оператора (> 8000 мкЗв/ч = 8.0 мЗв/ч)
    const isDoseRateExtreme = telemetry.currentDoseRateMicroSv >= 8000;

    const isInCriticalHazard =
      isCriticalDose || isPpeBreach || isGrabWithoutTool || isUnshieldedCriticalProximity || isDoseRateExtreme;

    // ========================================================================
    // 3. КРАСНАЯ ЗОНА: ОКНО ЭКСТРЕННОГО ОТСТУПЛЕНИЯ (RETREAT GRACE PERIOD)
    // ========================================================================
    if (isInCriticalHazard) {
      this.isRetreatGraceActive = true;
      this.zoneAlertLevel = 'red_retreat';
      this.retreatGraceRemainingSec = Math.max(0, this.retreatGraceRemainingSec - dt);

      let reasonText = '🚨 КРИТИЧЕСКАЯ ЗОНА! СРОЧНО ОТСТУПИТЕ НАЗАД В БЕЗОПАСНУЮ ЗОНУ!';
      if (isCriticalDose) {
        reasonText = `🚨 ПРЕВЫШЕН ЛИМИТ ДОЗЫ ${(telemetry.cumulativeDoseMsv * 1000).toFixed(0)} мкЗв! СРОЧНО ОТОЙДИТЕ НАЗАД!`;
      } else if (isPpeBreach) {
        reasonText = '🚨 ВХОД В ОЧАГ БЕЗ СПЕЦОДЕЖДЫ! ОТОЙДИТЕ В БЕЗОПАСНУЮ ЗОНУ!';
      } else if (isGrabWithoutTool) {
        reasonText = '🚨 ЗАХВАТ ИСТОЧНИКА ГОЛЫМИ РУКАМИ! ПОЛОЖИТЕ И ВОЗЬМИТЕ МАНИПУЛЯТОР!';
      } else if (isUnshieldedCriticalProximity) {
        reasonText = '🚨 ПРЯМОЙ ПУЧОК БЕЗ ЭКРАНА! ОТОЙДИТЕ И УСТАНОВИТЕ ЗАЩИТУ!';
      }

      this.retreatGraceReasonRu = `${reasonText} (До аварийного сброса: ${this.retreatGraceRemainingSec.toFixed(1)} с)`;

      // Если студент исчерпал всё 8-секундное окно и не отступил назад — фиксируется провал
      if (this.retreatGraceRemainingSec <= 0) {
        let failCode: ScenarioFailCode = 'DOSE_LIMIT_EXCEEDED';
        let failTitle = 'КРИТИЧЕСКАЯ ДОЗОВАЯ НАГРУЗКА';
        let failReason = `Студент находился в очаге более 8 секунд без применения мер защиты. H_accum = ${(telemetry.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв.`;

        if (isPpeBreach) {
          failCode = 'PPE_VIOLATION';
          failTitle = 'НАРУШЕНИЕ СИЗ И ТЕХНИКИ БЕЗОПАСНОСТИ';
          failReason = 'Не выполнены требования по применению СИЗ в зоне радиационной опасности.';
        } else if (isGrabWithoutTool) {
          failCode = 'SHIELD_OR_TOOL_VIOLATION';
          failTitle = 'ЗАХВАТ ИСТОЧНИКА БЕЗ МАНИПУЛЯТОРА';
          failReason = 'Запрещено удерживать активный образец голыми руками.';
        } else if (isUnshieldedCriticalProximity) {
          failCode = 'SHIELD_OR_TOOL_VIOLATION';
          failTitle = 'ВХОД В ПУЧОК БЕЗ ЗАЩИТНОГО ЭКРАНА';
          failReason = 'Не установлен защитный блок перед сближением с источником.';
        }

        const fail = this.enterFailedState(failCode, failTitle, failReason, 'Нарушение регламента РХБЗ', telemetry);
        return this.buildFailedEvaluationResult(cfg, fail, doseRatio, timeRatio);
      }

      // Пока действует окно отступления — управление НЕ блокируется, звучит непрерывный треск
      return {
        config: cfg,
        isFailed: false,
        isMovementFrozen: false,
        isWarning80Active: true,
        warning80Type: 'safety_near_miss',
        warning80MessageRu: this.retreatGraceReasonRu,
        doseProgressRatio: doseRatio,
        timeProgressRatio: timeRatio,
        audioCrackleMultiplier: 4.8, // непрерывный учащенный треск и пульсация тревоги
        failState: null,
        zoneAlertLevel: 'red_retreat',
        isRetreatCountdownActive: true,
        retreatCountdownRemainingSec: this.retreatGraceRemainingSec,
        retreatAlertMessageRu: this.retreatGraceReasonRu
      };
    }

    // Если студент успешно отступил назад — таймер плавно восстанавливается
    if (this.isRetreatGraceActive) {
      this.isRetreatGraceActive = false;
      this.retreatGraceRemainingSec = 8.0;
      this.retreatGraceReasonRu = null;
    } else {
      this.retreatGraceRemainingSec = Math.min(8.0, this.retreatGraceRemainingSec + dt * 2.5);
    }

    // ========================================================================
    // 4. ЖЕЛТАЯ И ЗЕЛЕНАЯ ЗОНЫ (ПРЕДУПРЕЖДЕНИЯ И ПУЛЬСАЦИЯ ПРИБОРА)
    // ========================================================================
    const warnThreshold = cfg.warningThresholdRatio; // 0.80
    const isDoseWarn = doseRatio >= warnThreshold || doseRatio >= 0.70;
    const isTimeWarn = timeRatio >= warnThreshold;
    const isElevatedField = telemetry.currentDoseRateMicroSv >= 800; // >= 0.8 мЗв/ч

    const isYellowZone = isDoseWarn || isTimeWarn || isElevatedField;

    if (isYellowZone) {
      this.zoneAlertLevel = 'yellow';
      this.isWarning80Active = true;
    } else {
      this.zoneAlertLevel = 'green';
      this.isWarning80Active = false;
    }

    let warning80Type: ScenarioRulesEvaluationResult['warning80Type'] = 'none';
    let warning80MessageRu: string | null = null;

    if (isDoseWarn && isTimeWarn) {
      warning80Type = 'both';
      warning80MessageRu = `ВНИМАНИЕ (ЖЕЛТАЯ ЗОНА): Доза ${(doseRatio * 100).toFixed(0)}% от H_limit и время ${(timeRatio * 100).toFixed(0)}% от T_max!`;
    } else if (isDoseWarn) {
      warning80Type = 'dose';
      warning80MessageRu = `ВНИМАНИЕ: Накопленная доза достигла ${(doseRatio * 100).toFixed(0)}% от контрольного предела!`;
    } else if (isElevatedField) {
      warning80Type = 'safety_near_miss';
      warning80MessageRu = `ЖЕЛТАЯ ЗОНА: Мощность дозы ${(telemetry.currentDoseRateMicroSv / 1000).toFixed(2)} мЗв/ч. Контролируйте время пребывания (Защита временем).`;
    }

    if (this.isWarning80Active) {
      if (!this.warning80Notified && warning80MessageRu) {
        this.warning80Notified = true;
        this.callbacks.onWarning80Triggered?.(warning80MessageRu, doseRatio, timeRatio);
      }

      const nowMs = performance.now();
      if (nowMs - this.lastWarningHapticTimeMs >= this.WARNING_HAPTIC_INTERVAL_MS) {
        this.lastWarningHapticTimeMs = nowMs;
        this.callbacks.onWarning80HapticPulse?.();
      }
    } else {
      this.warning80Notified = false;
    }

    const audioCrackleMultiplier = isYellowZone ? 2.4 : 1.0;

    return {
      config: cfg,
      isFailed: false,
      isMovementFrozen: false,
      isWarning80Active: this.isWarning80Active,
      warning80Type,
      warning80MessageRu,
      doseProgressRatio: doseRatio,
      timeProgressRatio: timeRatio,
      audioCrackleMultiplier,
      failState: null,
      zoneAlertLevel: this.zoneAlertLevel,
      isRetreatCountdownActive: false,
      retreatCountdownRemainingSec: this.retreatGraceRemainingSec,
      retreatAlertMessageRu: null
    };
  }

  private enterFailedState(
    failCode: ScenarioFailCode,
    titleRu: string,
    reasonRu: string,
    violatedItemSummaryRu: string,
    telemetry: ScenarioRuntimeTelemetry
  ): ScenarioFailedState {
    const cfg = this.currentConfig;
    const state: ScenarioFailedState = {
      isFailed: true,
      failCode,
      titleRu,
      reasonRu,
      normativeRu: cfg.failMessagesRu.normativeReference,
      scenarioTitleRu: cfg.titleRu,
      failedAtSec: telemetry.elapsedSec,
      finalDoseMsv: telemetry.cumulativeDoseMsv,
      hLimitMsv: cfg.hLimitMsv,
      tMaxSec: cfg.tMaxSec,
      violatedItemSummaryRu,
      countdownSec: 5.0
    };

    this.isFailed = true;
    this.isMovementFrozen = true;
    this.isWarning80Active = true;
    this.failState = state;

    this.callbacks.onScenarioFailed?.(state);
    return state;
  }

  private buildFailedEvaluationResult(
    cfg: IScenarioConfig,
    fail: ScenarioFailedState,
    doseRatio: number,
    timeRatio: number
  ): ScenarioRulesEvaluationResult {
    return {
      config: cfg,
      isFailed: true,
      isMovementFrozen: true,
      isWarning80Active: true,
      warning80Type: 'both',
      warning80MessageRu: fail.reasonRu,
      doseProgressRatio: doseRatio,
      timeProgressRatio: timeRatio,
      audioCrackleMultiplier: 2.6,
      failState: { ...fail },
      zoneAlertLevel: 'red_retreat',
      isRetreatCountdownActive: false,
      retreatCountdownRemainingSec: 0,
      retreatAlertMessageRu: fail.reasonRu
    };
  }
}
