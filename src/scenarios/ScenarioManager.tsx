/**
 * ALARA-Planner Pro — Менеджер состояния, стейт-машины, дозовой нагрузки и процедурного спавна
 * (src/scenarios/ScenarioManager.tsx)
 *
 * Реализует:
 * 1. Конечный автомат сценария (State Machine):
 *      INIT -> RUNNING -> CRITICAL_WARNING -> COMPLETED / FAILED
 * 2. Расчет суммарной Мощности Эквивалентной Дозы (МЭД) и накопленной дозы H(t)
 *    в реальном времени через `PhysicsEngine.ts` по всем активным `HazardEntity[]`.
 * 3. Автоматическую проверку выполнения задач (`ScenarioObjective`) и условий провала
 *    (превышение лимита дозы по НРБ-99/2009, истечение времени T_max, вход в очаг без СИЗ).
 * 4. Режим случайного спавна угроз ('Randomized Hazard Mode'):
 *    - Процедурная генерация координат [X, Y, Z] источников в границах помещения (Room Bounds).
 *    - Процедурная вариация активности источников (Activity Levels) в заданном диапазоне.
 *    - Учет архетипов геометрии (лужи и обломки на полу, вентили на стенах, безопасный буфер от спавна игрока).
 *    - Предотвращение наложения 3D-мешей (Inter-hazard collision clearance).
 */

import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import {
  calculateDoseRateDetailed,
  accumulateDose,
  ShieldLayer,
  ShieldMaterialId
} from '../physics/PhysicsEngine';
import {
  ScenarioData,
  ScenarioLifecycleState,
  ScenarioObjective,
  HazardEntity
} from './types';
import { getScenarioDataById } from './ScenarioRegistry';

// ============================================================================
// 1. КОНФИГУРАЦИЯ ГРАНИЦ ПОМЕЩЕНИЙ И СЛУЧАЙНОЙ ГЕНЕРАЦИИ (ROOM BOUNDS)
// ============================================================================

export interface RoomBounds {
  /** Минимальная координата X помещения (м) */
  minX: number;
  /** Максимальная координата X помещения (м) */
  maxX: number;
  /** Минимальная высота Y (м) */
  minY: number;
  /** Максимальная высота Y (м) */
  maxY: number;
  /** Минимальная координата Z помещения (м) */
  minZ: number;
  /** Максимальная координата Z помещения (м) */
  maxZ: number;
  /** Безопасная буферная зона от точки спавна оператора (м) */
  minDistanceFromPlayerStartM: number;
  /** Минимальное расстояние между двумя источниками для исключения наложения мешей (м) */
  minInterHazardDistanceM: number;
}

export interface RandomizedHazardModeConfig {
  /** Включен ли режим случайного процедурного спавна источников */
  enabled: boolean;
  /** Кастомные границы помещения (если не заданы, берутся по сценарию или дефолтные) */
  roomBounds?: Partial<RoomBounds>;
  /** Диапазон случайного множителя активности источников [min, max] (по умолчанию [0.5, 2.2]) */
  activityMultiplierRange?: [number, number];
  /** Опциональный фиксированный seed для воспроизводимой генерации */
  seed?: number;
}

export const DEFAULT_ROOM_BOUNDS: RoomBounds = {
  minX: -4.2,
  maxX: 4.2,
  minY: 0.05,
  maxY: 1.4,
  minZ: -5.8,
  maxZ: 0.2,
  minDistanceFromPlayerStartM: 2.6,
  minInterHazardDistanceM: 1.2
};

export const SCENARIO_ROOM_BOUNDS: Readonly<Record<number, Partial<RoomBounds>>> = {
  1: { minX: -3.8, maxX: 3.8, minZ: -5.5, maxZ: -0.5 }, // NPP Reactor Hall
  2: { minX: -4.0, maxX: 4.0, minZ: -5.0, maxZ: 0.0 },  // Coolant loop
  3: { minX: -3.5, maxX: 3.5, minZ: -4.8, maxZ: -0.2 }, // Radiotherapy bunker
  4: { minX: -4.2, maxX: 4.2, minZ: -5.8, maxZ: 0.5 },  // Flaw detection lab
  5: { minX: -4.5, maxX: 4.5, minZ: -6.0, maxZ: 0.0 },  // Arctic RITEG site
  6: { minX: -3.6, maxX: 3.6, minZ: -4.5, maxZ: -0.4 }, // Radiochemical hot cell
  7: { minX: -4.0, maxX: 4.0, minZ: -5.2, maxZ: 0.0 },  // Waste storage facility
  8: { minX: -4.2, maxX: 4.2, minZ: -5.5, maxZ: 0.2 },  // Transport rail accident
  9: { minX: -3.8, maxX: 3.8, minZ: -5.0, maxZ: -0.2 }, // Medical cyclotron target
  10: { minX: -4.5, maxX: 4.5, minZ: -6.0, maxZ: 0.0 }, // Dirty bomb urban perimeter
  11: { minX: -3.5, maxX: 3.5, minZ: -4.5, maxZ: 0.0 }, // Radium luminescence workshop
  12: { minX: -4.0, maxX: 4.0, minZ: -5.5, maxZ: -0.2 }  // Plutonium reprocessing line
};

/**
 * Процедурный генератор случайного размещения и активности источников угрозы
 * в пределах заданных границ помещения
 */
export function generateRandomizedHazards(
  baseHazards: ReadonlyArray<HazardEntity>,
  playerStartPosition: readonly [number, number, number],
  customBounds?: Partial<RoomBounds>,
  config?: RandomizedHazardModeConfig
): HazardEntity[] {
  const bounds: RoomBounds = {
    ...DEFAULT_ROOM_BOUNDS,
    ...customBounds
  };

  const activityMin = config?.activityMultiplierRange?.[0] ?? 0.5;
  const activityMax = config?.activityMultiplierRange?.[1] ?? 2.2;
  const minClearanceFromPlayer = bounds.minDistanceFromPlayerStartM ?? 2.6;
  const minInterHazard = bounds.minInterHazardDistanceM ?? 1.2;

  const placedPositions: Array<[number, number, number]> = [];
  const randomizedHazards: HazardEntity[] = [];

  baseHazards.forEach(baseHazard => {
    const archetype = baseHazard.geometryData.archetype;
    let minY = bounds.minY;
    let maxY = bounds.maxY;

    // Учет реалистичной высоты размещения в зависимости от архетипа объекта
    if (archetype === 'radiochem_puddle') {
      minY = 0.02;
      maxY = 0.05;
    } else if (archetype === 'graphite_block' || baseHazard.type === 'debris') {
      minY = 0.06;
      maxY = 0.22;
    } else if (archetype === 'corroded_waste_drum' || archetype === 'tuk_transport_cask') {
      minY = 0.25;
      maxY = 0.55;
    } else if (archetype === 'fuel_assembly_fragment') {
      minY = 0.15;
      maxY = 0.42;
    } else if (archetype === 'high_pressure_steam_valve' || baseHazard.type === 'leak_valve') {
      minY = 0.55;
      maxY = 1.35;
    } else if (baseHazard.type === 'plume') {
      minY = 0.45;
      maxY = 1.20;
    }

    // Итеративный подбор валидных координат без перекрытий
    let bestX = baseHazard.position[0];
    let bestY = baseHazard.position[1];
    let bestZ = baseHazard.position[2];
    let foundValid = false;

    for (let attempt = 0; attempt < 45; attempt++) {
      const candX = Number(
        (bounds.minX + Math.random() * (bounds.maxX - bounds.minX)).toFixed(2)
      );
      const candZ = Number(
        (bounds.minZ + Math.random() * (bounds.maxZ - bounds.minZ)).toFixed(2)
      );
      const candY = Number((minY + Math.random() * (maxY - minY)).toFixed(2));

      // Проверка дистанции до спавна игрока
      const distToPlayer = Math.hypot(
        candX - playerStartPosition[0],
        candZ - playerStartPosition[2]
      );
      if (distToPlayer < minClearanceFromPlayer) {
        continue;
      }

      // Проверка дистанции до ранее размещенных источников
      let tooClose = false;
      for (const pos of placedPositions) {
        const d = Math.hypot(candX - pos[0], candZ - pos[2]);
        if (d < minInterHazard) {
          tooClose = true;
          break;
        }
      }
      if (tooClose) {
        continue;
      }

      bestX = candX;
      bestY = candY;
      bestZ = candZ;
      foundValid = true;
      break;
    }

    if (!foundValid && placedPositions.length > 0) {
      bestX = Math.max(
        bounds.minX,
        Math.min(bounds.maxX, Number((baseHazard.position[0] + (Math.random() - 0.5) * 1.5).toFixed(2)))
      );
      bestZ = Math.max(
        bounds.minZ,
        Math.min(bounds.maxZ, Number((baseHazard.position[2] + (Math.random() - 0.5) * 1.5).toFixed(2)))
      );
    }

    placedPositions.push([bestX, bestY, bestZ]);

    // Процедурный расчет вариации активности источника
    const activityMult = Number(
      (activityMin + Math.random() * (activityMax - activityMin)).toFixed(2)
    );
    const newActivityGbk = Number(
      (baseHazard.activityGbk * activityMult).toFixed(baseHazard.activityGbk < 10 ? 2 : 1)
    );

    // Процедурная вариация угла поворота 3D меша
    let newRotation: [number, number, number];
    if (archetype === 'radiochem_puddle') {
      newRotation = [0, Number((Math.random() * Math.PI * 2).toFixed(2)), 0];
    } else if (archetype === 'high_pressure_steam_valve') {
      newRotation = [0, Number(((Math.floor(Math.random() * 4) * Math.PI) / 2).toFixed(2)), 0];
    } else {
      newRotation = [
        Number(((Math.random() - 0.5) * 0.35).toFixed(2)),
        Number((Math.random() * Math.PI * 2).toFixed(2)),
        Number(((Math.random() - 0.5) * 0.35).toFixed(2))
      ];
    }

    // Масштабирование ореола Черенкова и параметров выброса плюма при изменении активности
    let cherenkovRadiusMeters = baseHazard.geometryData.cherenkovRadiusMeters;
    if (cherenkovRadiusMeters !== undefined) {
      const scale = Math.cbrt(activityMult);
      cherenkovRadiusMeters = Number(
        (cherenkovRadiusMeters * Math.max(0.65, Math.min(1.65, scale))).toFixed(2)
      );
    }

    let plumeConfig = baseHazard.geometryData.plumeConfig;
    if (plumeConfig) {
      const lengthScale = Math.sqrt(activityMult);
      plumeConfig = {
        ...plumeConfig,
        plumeLengthMeters: Number(
          (plumeConfig.plumeLengthMeters * Math.max(0.7, Math.min(1.5, lengthScale))).toFixed(1)
        ),
        releaseHeightMeters: bestY,
        baseOpacity: Number(
          Math.min(0.65, Math.max(0.15, plumeConfig.baseOpacity * Math.sqrt(activityMult))).toFixed(2)
        )
      };
    }

    randomizedHazards.push({
      ...baseHazard,
      position: [bestX, bestY, bestZ],
      activityGbk: newActivityGbk,
      geometryData: {
        ...baseHazard.geometryData,
        rotationEulerRad: newRotation,
        cherenkovRadiusMeters,
        plumeConfig
      }
    });
  });

  return randomizedHazards;
}

// ============================================================================
// 2. ИНТЕРФЕЙСЫ СОСТОЯНИЯ СИМУЛЯЦИИ И КОЛЛБЭКОВ СТЕЙТ-МАШИНЫ
// ============================================================================

export type ScenarioFailureReasonCode =
  | 'DOSE_LIMIT_EXCEEDED'
  | 'TIME_LIMIT_EXCEEDED'
  | 'PPE_VIOLATION_IN_HOT_ZONE'
  | 'CRITICAL_OBJECTIVE_FAILED';

export interface ScenarioEvaluationSnapshot {
  readonly scenarioId: number;
  readonly state: ScenarioLifecycleState;
  readonly elapsedTimeSec: number;
  readonly currentDoseRateMsvPerHour: number;
  readonly accumulatedDoseMsv: number;
  readonly doseLimitMsv: number;
  readonly maxDurationSec: number;
  readonly doseRatio: number;
  readonly timeRatio: number;
  readonly objectives: ReadonlyArray<ScenarioObjective>;
  readonly completedObjectivesCount: number;
  readonly nearestHazardDistanceM: number;
  readonly failureReasonCode: ScenarioFailureReasonCode | null;
  readonly failureMessageRu: string | null;
  readonly warningMessageRu: string | null;
  readonly isRandomizedHazardMode: boolean;
  readonly activeHazards: ReadonlyArray<HazardEntity>;
}

export interface ScenarioStepInput {
  /** Текущая мировая позиция оператора/спасателя */
  readonly playerWorldPosition: THREE.Vector3 | readonly [number, number, number];
  /** Надет ли изолирующий комплект СИЗ */
  readonly isWearingHazmatPpe: boolean;
  /** Дополнительные динамические экраны между источником и спасателем */
  readonly extraShieldLayers?: ReadonlyArray<ShieldLayer>;
  /** Идентификатор объекта угрозы, с которым спасатель выполнил целевое действие */
  readonly interactedHazardId?: string | null;
}

// ============================================================================
// 3. ДВИЖОК КОНЕЧНОГО АВТОМАТА СЦЕНАРИЯ (ScenarioStateMachineEngine)
// ============================================================================

export class ScenarioStateMachineEngine {
  private scenario: ScenarioData;
  private state: ScenarioLifecycleState = 'INIT';
  private elapsedTimeSec = 0.0;
  private currentDoseRateMsvPerHour = 0.0;
  private accumulatedDoseMsv = 0.0;
  private nearestHazardDistanceM = 999.0;
  private objectives: ScenarioObjective[] = [];
  private mitigatedHazardIds = new Set<string>();
  private failureReasonCode: ScenarioFailureReasonCode | null = null;
  private failureMessageRu: string | null = null;
  private warningMessageRu: string | null = null;
  private isRandomizedHazardMode = false;
  private randomizedConfig?: RandomizedHazardModeConfig;

  constructor(
    scenarioId: number = 1,
    initialRandomizedMode: boolean = false,
    randomizedConfig?: RandomizedHazardModeConfig
  ) {
    this.scenario = getScenarioDataById(scenarioId);
    this.isRandomizedHazardMode = initialRandomizedMode;
    this.randomizedConfig = randomizedConfig;
    this.reset(scenarioId, initialRandomizedMode, randomizedConfig);
  }

  /**
   * Сброс и инициализация сценария в начальное состояние `INIT` -> `RUNNING`
   */
  public reset(
    scenarioId?: number,
    randomizedMode?: boolean,
    randomizedConfig?: RandomizedHazardModeConfig
  ): ScenarioEvaluationSnapshot {
    if (typeof scenarioId === 'number') {
      this.scenario = getScenarioDataById(scenarioId);
    }
    if (typeof randomizedMode === 'boolean') {
      this.isRandomizedHazardMode = randomizedMode;
    }
    if (randomizedConfig !== undefined) {
      this.randomizedConfig = randomizedConfig;
    }

    // Если включен режим случайного спавна — генерируем процедурные координаты и активности
    if (this.isRandomizedHazardMode) {
      const roomBounds = {
        ...SCENARIO_ROOM_BOUNDS[this.scenario.id],
        ...this.randomizedConfig?.roomBounds
      };
      const randomizedHazards = generateRandomizedHazards(
        this.scenario.hazards,
        this.scenario.playerStartPosition,
        roomBounds,
        this.randomizedConfig
      );
      this.scenario = {
        ...this.scenario,
        hazards: randomizedHazards
      };
    } else {
      // Восстанавливаем оригинальные детерминированные источники
      this.scenario = getScenarioDataById(this.scenario.id);
    }

    this.state = 'INIT';
    this.elapsedTimeSec = 0.0;
    this.currentDoseRateMsvPerHour = 0.0;
    this.accumulatedDoseMsv = 0.0;
    this.nearestHazardDistanceM = 999.0;
    this.mitigatedHazardIds.clear();
    this.failureReasonCode = null;
    this.failureMessageRu = null;
    this.warningMessageRu = null;

    this.objectives = this.scenario.objectives.map(obj => ({
      ...obj,
      status: 'pending'
    }));

    return this.getSnapshot();
  }

  /**
   * Включение или выключение режима случайного спавна
   */
  public setRandomizedHazardMode(
    enabled: boolean,
    config?: RandomizedHazardModeConfig
  ): ScenarioEvaluationSnapshot {
    this.isRandomizedHazardMode = enabled;
    if (config) {
      this.randomizedConfig = config;
    }
    return this.reset(this.scenario.id, enabled, config);
  }

  /**
   * Принудительная перегенерация случайных источников в границах помещения
   */
  public regenerateRandomizedHazards(): ScenarioEvaluationSnapshot {
    return this.reset(this.scenario.id, true, this.randomizedConfig);
  }

  public isRandomizedHazardModeActive(): boolean {
    return this.isRandomizedHazardMode;
  }

  public getActiveHazards(): ReadonlyArray<HazardEntity> {
    return this.scenario.hazards;
  }

  /**
   * Перевод стейт-машины из `INIT` в активную фазу `RUNNING`
   */
  public start(): void {
    if (this.state === 'INIT') {
      this.state = 'RUNNING';
    }
  }

  /**
   * Отмечает физический источник угрозы как локализованный / экранированный
   */
  public markHazardMitigated(hazardId: string): void {
    this.mitigatedHazardIds.add(hazardId);
  }

  /**
   * Принудительное выполнение задачи по её ID или по целевому объекту HazardEntity
   */
  public completeObjectiveByTarget(targetOrObjectiveId: string): boolean {
    let updated = false;
    for (const obj of this.objectives) {
      if (
        obj.status === 'pending' &&
        (obj.id === targetOrObjectiveId || obj.targetEntityId === targetOrObjectiveId)
      ) {
        obj.status = 'completed';
        if (obj.targetEntityId) {
          this.mitigatedHazardIds.add(obj.targetEntityId);
        }
        updated = true;
        break;
      }
    }

    if (updated && this.objectives.every(o => o.status === 'completed')) {
      this.state = 'COMPLETED';
    }
    return updated;
  }

  /**
   * Шаг симуляции Δt:
   * 1. Вычисляет суммарную МЭД от всех активных источников по формуле Бергера.
   * 2. Интегрирует накопленную дозу.
   * 3. Проверяет условия СИЗ, времени, лимита дозы и переходов стейт-машины.
   */
  public step(deltaTimeSeconds: number, input: ScenarioStepInput): ScenarioEvaluationSnapshot {
    if (this.state === 'INIT') {
      this.state = 'RUNNING';
    }

    if (this.state === 'COMPLETED' || this.state === 'FAILED') {
      return this.getSnapshot();
    }

    const dt = Math.min(0.25, Math.max(0.0, deltaTimeSeconds));
    this.elapsedTimeSec += dt;

    const px = Array.isArray(input.playerWorldPosition)
      ? input.playerWorldPosition[0]
      : (input.playerWorldPosition as THREE.Vector3).x;
    const py = Array.isArray(input.playerWorldPosition)
      ? input.playerWorldPosition[1]
      : (input.playerWorldPosition as THREE.Vector3).y;
    const pz = Array.isArray(input.playerWorldPosition)
      ? input.playerWorldPosition[2]
      : (input.playerWorldPosition as THREE.Vector3).z;

    let totalRateMsvPerHour = 0.0;
    let minDistanceM = 999.0;

    for (const hazard of this.scenario.hazards) {
      const dx = px - hazard.position[0];
      const dy = py - hazard.position[1];
      const dz = pz - hazard.position[2];
      const distM = Math.sqrt(dx * dx + dy * dy + dz * dz);

      if (distM < minDistanceM) {
        minDistanceM = distM;
      }

      const layers: ShieldLayer[] = [];
      if (hazard.materialShieldKey && hazard.shieldThicknessCm && hazard.shieldThicknessCm > 0) {
        layers.push({
          material: hazard.materialShieldKey as ShieldMaterialId,
          thicknessCm: hazard.shieldThicknessCm
        });
      }
      if (input.extraShieldLayers && input.extraShieldLayers.length > 0) {
        layers.push(...input.extraShieldLayers);
      }

      if (this.mitigatedHazardIds.has(hazard.id) || hazard.isMitigated) {
        layers.push({ material: 'lead', thicknessCm: 5.0 });
      }

      const calc = calculateDoseRateDetailed({
        radionuclide: hazard.radionuclideKey,
        activityGBq: hazard.activityGbk,
        distanceMeters: distM,
        shieldLayers: layers,
        elapsedDecayTimeSeconds: this.elapsedTimeSec
      });

      totalRateMsvPerHour += calc.doseRateMsvPerHour;
    }

    this.currentDoseRateMsvPerHour = totalRateMsvPerHour;
    this.nearestHazardDistanceM = minDistanceM;

    this.accumulatedDoseMsv = accumulateDose(
      totalRateMsvPerHour,
      dt,
      this.accumulatedDoseMsv
    );

    if (input.interactedHazardId) {
      this.completeObjectiveByTarget(input.interactedHazardId);
    } else {
      const firstPending = this.objectives.find(o => o.status === 'pending');
      if (firstPending && firstPending.targetEntityId && firstPending.requiredProximityMeters) {
        const targetHazard = this.scenario.hazards.find(h => h.id === firstPending.targetEntityId);
        if (targetHazard) {
          const d = Math.hypot(
            px - targetHazard.position[0],
            pz - targetHazard.position[2]
          );
          if (d <= firstPending.requiredProximityMeters && firstPending.id.includes('_1_')) {
            firstPending.status = 'completed';
          }
        }
      }
    }

    if (
      this.scenario.requireHazmatPpe &&
      !input.isWearingHazmatPpe &&
      minDistanceM < 3.8
    ) {
      this.state = 'FAILED';
      this.failureReasonCode = 'PPE_VIOLATION_IN_HOT_ZONE';
      this.failureMessageRu =
        'Грубое нарушение ОСПОРБ-99/2010: вход в зону открытых радионуклидов и аэрозолей без изолирующего комплекта СИЗ!';
      return this.getSnapshot();
    }

    if (this.accumulatedDoseMsv >= this.scenario.doseLimitMsv) {
      this.state = 'FAILED';
      this.failureReasonCode = 'DOSE_LIMIT_EXCEEDED';
      this.failureMessageRu = `ПРЕВЫШЕН КОНТРОЛЬНЫЙ ПРЕДЕЛ ДОЗЫ! ПРЕВЫШЕНИЕ НРБ-99/2009 (${this.scenario.doseLimitMsv.toFixed(2)} мЗв)! Сработала система аварийного сброса.`;
      return this.getSnapshot();
    }

    if (this.elapsedTimeSec >= this.scenario.maxDurationSec) {
      this.state = 'FAILED';
      this.failureReasonCode = 'TIME_LIMIT_EXCEEDED';
      this.failureMessageRu = `ВРЕМЯ МИССИИ ИСТЕКЛО! Превышено контрольное нормативное время выполнения задач (${this.scenario.maxDurationSec} с)!`;
      return this.getSnapshot();
    }

    if (this.objectives.every(o => o.status === 'completed')) {
      this.state = 'COMPLETED';
      this.warningMessageRu = null;
      return this.getSnapshot();
    }

    const doseRatio = this.accumulatedDoseMsv / Math.max(1e-6, this.scenario.doseLimitMsv);
    const timeRatio = this.elapsedTimeSec / Math.max(1.0, this.scenario.maxDurationSec);

    if (doseRatio >= 0.8 || timeRatio >= 0.8) {
      this.state = 'CRITICAL_WARNING';
      this.warningMessageRu =
        doseRatio >= 0.8
          ? `ВНИМАНИЕ: Накопленная доза достигла ${(doseRatio * 100).toFixed(0)}% от аварийного предела НРБ!`
          : `ВНИМАНИЕ: Израсходовано ${(timeRatio * 100).toFixed(0)}% допустимого времени работы в очаге!`;
    } else {
      this.state = 'RUNNING';
      this.warningMessageRu = null;
    }

    return this.getSnapshot();
  }

  public getScenarioData(): ScenarioData {
    return this.scenario;
  }

  public getSnapshot(): ScenarioEvaluationSnapshot {
    const doseRatio = Math.min(
      1.0,
      this.accumulatedDoseMsv / Math.max(1e-6, this.scenario.doseLimitMsv)
    );
    const timeRatio = Math.min(
      1.0,
      this.elapsedTimeSec / Math.max(1.0, this.scenario.maxDurationSec)
    );

    return {
      scenarioId: this.scenario.id,
      state: this.state,
      elapsedTimeSec: this.elapsedTimeSec,
      currentDoseRateMsvPerHour: this.currentDoseRateMsvPerHour,
      accumulatedDoseMsv: this.accumulatedDoseMsv,
      doseLimitMsv: this.scenario.doseLimitMsv,
      maxDurationSec: this.scenario.maxDurationSec,
      doseRatio,
      timeRatio,
      objectives: this.objectives.map(o => ({ ...o })),
      completedObjectivesCount: this.objectives.filter(o => o.status === 'completed').length,
      nearestHazardDistanceM: this.nearestHazardDistanceM,
      failureReasonCode: this.failureReasonCode,
      failureMessageRu: this.failureMessageRu,
      warningMessageRu: this.warningMessageRu,
      isRandomizedHazardMode: this.isRandomizedHazardMode,
      activeHazards: this.scenario.hazards
    };
  }
}

// ============================================================================
// 4. REACT КОНТЕКСТ И КОМПОНЕНТ ScenarioManager
// ============================================================================

export interface ScenarioManagerContextValue {
  readonly scenarioData: ScenarioData;
  readonly snapshot: ScenarioEvaluationSnapshot;
  readonly activeHazards: ReadonlyArray<HazardEntity>;
  readonly isRandomizedHazardMode: boolean;
  readonly setRandomizedHazardMode: (enabled: boolean, config?: RandomizedHazardModeConfig) => void;
  readonly regenerateRandomizedHazards: () => void;
  readonly completeObjective: (targetOrObjectiveId: string) => void;
  readonly resetScenario: (newScenarioId?: number) => void;
}

const ScenarioManagerContext = createContext<ScenarioManagerContextValue | null>(null);

export function useScenarioManager(): ScenarioManagerContextValue {
  const ctx = useContext(ScenarioManagerContext);
  if (!ctx) {
    const fallbackEngine = new ScenarioStateMachineEngine(1);
    return {
      scenarioData: fallbackEngine.getScenarioData(),
      snapshot: fallbackEngine.getSnapshot(),
      activeHazards: fallbackEngine.getActiveHazards(),
      isRandomizedHazardMode: false,
      setRandomizedHazardMode: () => {},
      regenerateRandomizedHazards: () => {},
      completeObjective: () => {},
      resetScenario: () => {}
    };
  }
  return ctx;
}

export interface ScenarioManagerProps {
  readonly scenarioId: number;
  readonly playerGroupRef?: React.RefObject<THREE.Object3D | null>;
  readonly isWearingHazmatPpe?: boolean;
  readonly extraShieldLayers?: ReadonlyArray<ShieldLayer>;
  /** Активировать режим процедурной генерации координат и активности источников */
  readonly randomizedHazardMode?: boolean;
  /** Дополнительная конфигурация границ и множителей активности для режима генерации */
  readonly randomizedHazardConfig?: RandomizedHazardModeConfig;
  /** Опциональный коллбэк при изменении набора активных источников угроз */
  readonly onHazardsGenerated?: (hazards: ReadonlyArray<HazardEntity>) => void;
  readonly onStateChange?: (snapshot: ScenarioEvaluationSnapshot, scenario: ScenarioData) => void;
  readonly children?: React.ReactNode | ((context: ScenarioManagerContextValue) => React.ReactNode);
}

export const ScenarioManager: React.FC<ScenarioManagerProps> = ({
  scenarioId,
  playerGroupRef,
  isWearingHazmatPpe = true,
  extraShieldLayers,
  randomizedHazardMode = false,
  randomizedHazardConfig,
  onHazardsGenerated,
  onStateChange,
  children
}) => {
  const engineRef = useRef<ScenarioStateMachineEngine | null>(null);
  if (!engineRef.current) {
    engineRef.current = new ScenarioStateMachineEngine(
      scenarioId,
      randomizedHazardMode,
      randomizedHazardConfig
    );
  }

  const [scenarioData, setScenarioData] = useState<ScenarioData>(() =>
    engineRef.current!.getScenarioData()
  );
  const [snapshot, setSnapshot] = useState<ScenarioEvaluationSnapshot>(() =>
    engineRef.current!.getSnapshot()
  );
  const [activeHazards, setActiveHazards] = useState<ReadonlyArray<HazardEntity>>(() =>
    engineRef.current!.getActiveHazards()
  );

  const resetScenario = useCallback(
    (nextId?: number) => {
      const targetId = nextId ?? scenarioId;
      const newSnap = engineRef.current!.reset(
        targetId,
        randomizedHazardMode,
        randomizedHazardConfig
      );
      const newScen = engineRef.current!.getScenarioData();
      const currentHazards = engineRef.current!.getActiveHazards();
      setScenarioData(newScen);
      setSnapshot(newSnap);
      setActiveHazards(currentHazards);
      onHazardsGenerated?.(currentHazards);
      onStateChange?.(newSnap, newScen);
    },
    [scenarioId, randomizedHazardMode, randomizedHazardConfig, onHazardsGenerated, onStateChange]
  );

  const setRandomizedHazardMode = useCallback(
    (enabled: boolean, config?: RandomizedHazardModeConfig) => {
      if (!engineRef.current) return;
      const newSnap = engineRef.current.setRandomizedHazardMode(enabled, config);
      const newScen = engineRef.current.getScenarioData();
      const currentHazards = engineRef.current.getActiveHazards();
      setScenarioData(newScen);
      setSnapshot(newSnap);
      setActiveHazards(currentHazards);
      onHazardsGenerated?.(currentHazards);
      onStateChange?.(newSnap, newScen);
    },
    [onHazardsGenerated, onStateChange]
  );

  const regenerateRandomizedHazards = useCallback(() => {
    if (!engineRef.current) return;
    const newSnap = engineRef.current.regenerateRandomizedHazards();
    const newScen = engineRef.current.getScenarioData();
    const currentHazards = engineRef.current.getActiveHazards();
    setScenarioData(newScen);
    setSnapshot(newSnap);
    setActiveHazards(currentHazards);
    onHazardsGenerated?.(currentHazards);
    onStateChange?.(newSnap, newScen);
  }, [onHazardsGenerated, onStateChange]);

  const completeObjective = useCallback(
    (targetOrObjectiveId: string) => {
      if (!engineRef.current) return;
      engineRef.current.completeObjectiveByTarget(targetOrObjectiveId);
      const nextSnap = engineRef.current.getSnapshot();
      setSnapshot(nextSnap);
      onStateChange?.(nextSnap, engineRef.current.getScenarioData());
    },
    [onStateChange]
  );

  useEffect(() => {
    resetScenario(scenarioId);
  }, [scenarioId, randomizedHazardMode, resetScenario]);

  useEffect(() => {
    let lastTimeMs = performance.now();
    const intervalId = window.setInterval(() => {
      if (!engineRef.current) return;
      const nowMs = performance.now();
      const dt = Math.min(0.25, Math.max(0.0, (nowMs - lastTimeMs) / 1000.0));
      lastTimeMs = nowMs;

      const playerPos = playerGroupRef?.current?.position ?? new THREE.Vector3(0, 1.65, 4.2);
      const nextSnap = engineRef.current.step(dt, {
        playerWorldPosition: playerPos,
        isWearingHazmatPpe,
        extraShieldLayers
      });
      setSnapshot(nextSnap);
      onStateChange?.(nextSnap, engineRef.current.getScenarioData());
    }, 150);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [playerGroupRef, isWearingHazmatPpe, extraShieldLayers, onStateChange]);

  const contextValue: ScenarioManagerContextValue = {
    scenarioData,
    snapshot,
    activeHazards,
    isRandomizedHazardMode: snapshot.isRandomizedHazardMode,
    setRandomizedHazardMode,
    regenerateRandomizedHazards,
    completeObjective,
    resetScenario
  };

  return (
    <ScenarioManagerContext.Provider value={contextValue}>
      {typeof children === 'function' ? children(contextValue) : children}
    </ScenarioManagerContext.Provider>
  );
};
