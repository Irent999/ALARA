/**
 * ALARA — 5-фазный конечный автомат (State Machine) Сценария №4 МЧС АЭС
 * (src/state/scenario4StateMachine.ts)
 *
 * Фазы:
 * 1. LOADING_ASSET       — загрузка /assembly.glb, привязка узлов и зон
 * 2. BRIEFING_ENTRY      — инструктаж, экипировка ОУ-5, вход в аварийный энергоблок
 * 3. FIRE_SUPPRESSION    — поиск и тушение всех очагов возгорания, контроль заряда ОУ-5
 * 4. EVACUATION_ESCORT   — активация маршрутов эвакуации, сопровождение NPC в безопасную зону
 * 5. COMPLETED / FAILED  — итоговый протокол разбора (время, пожары, NPC, доза ALARA, перезапуск)
 */

import type { NppInspectionReport } from '../npp/nppSceneInspector';
import type {
  ExtinguisherLifecycleState,
  ExtinguisherStatus
} from '../mechanics/extinguisherSystem';
import type { MchsVehicleSnapshot } from '../mechanics/mchsVehicleSystem';
import type { EmergencyOpsSnapshot } from '../mechanics/emergencyOpsSystem';

export type Scenario4PhaseId =
  | 'LOADING_ASSET'
  | 'BRIEFING_ENTRY'
  | 'FIRE_SUPPRESSION'
  | 'EVACUATION_ESCORT'
  | 'COMPLETED'
  | 'FAILED';

export const SCENARIO4_PHASE_ORDER: ReadonlyArray<Scenario4PhaseId> = [
  'LOADING_ASSET',
  'BRIEFING_ENTRY',
  'FIRE_SUPPRESSION',
  'EVACUATION_ESCORT',
  'COMPLETED'
];

export interface Scenario4PhaseMeta {
  readonly id: Scenario4PhaseId;
  readonly stepNumber: number;
  readonly titleRu: string;
  readonly instructionRu: string;
}

export const SCENARIO4_PHASES: Readonly<Record<Scenario4PhaseId, Scenario4PhaseMeta>> = {
  LOADING_ASSET: {
    id: 'LOADING_ASSET',
    stepNumber: 1,
    titleRu: 'Инициализация 3D-комплекса АЭС',
    instructionRu: 'Загрузка /assembly.glb, расстановка оборудования, техники МЧС и очагов.'
  },
  BRIEFING_ENTRY: {
    id: 'BRIEFING_ENTRY',
    stepNumber: 2,
    titleRu: 'Подготовка средств тушения и вход в корпус',
    instructionRu:
      'Возьмите ОУ-5 [E] (чека [R]) или пожарный рукав у машины МЧС (посадка [Enter]) и войдите в корпус.'
  },
  FIRE_SUPPRESSION: {
    id: 'FIRE_SUPPRESSION',
    stepNumber: 3,
    titleRu: 'Тушение очагов и локализация аварийного контура',
    instructionRu:
      'Потушите очаги (ОУ-5 или рукав МЧС), перекройте аварийную задвижку и стабилизируйте пострадавшего.'
  },
  EVACUATION_ESCORT: {
    id: 'EVACUATION_ESCORT',
    stepNumber: 4,
    titleRu: 'Эвакуация персонала и выход',
    instructionRu:
      'Завершите аварийные операции, выведите 4 группы персонала (10 чел.) [E] и выйдите на Пункт сбора.'
  },
  COMPLETED: {
    id: 'COMPLETED',
    stepNumber: 5,
    titleRu: 'Операция завершена (Протокол МЧС)',
    instructionRu: 'Все очаги потушены, угрозы локализованы, персонал спасён. Изучите разбор ALARA.'
  },
  FAILED: {
    id: 'FAILED',
    stepNumber: 5,
    titleRu: 'Операция прервана (Нарушение нормативов)',
    instructionRu: 'Превышен норматив времени или предел дозы НРБ-99/2009. Перезапустите сценарий.'
  }
};

export interface Scenario4DebriefSummary {
  readonly outcome: 'COMPLETED' | 'FAILED';
  readonly failureReasonRu: string | null;
  readonly elapsedSec: number;
  readonly rescuedCount: number;
  readonly totalNpcCount: number;
  readonly extinguishedFires: number;
  readonly totalFires: number;
  readonly remainingExtinguisherPct: number;
  readonly cylindersUsed: number;
  readonly radReconDone: boolean;
  readonly loopIsolated: boolean;
  readonly casualtyStabilized: boolean;
  readonly usedHoseOrVehicle: boolean;
  readonly cumulativeDoseMsv: number;
  readonly peakHeatLoadPct: number;
  readonly safetyErrors: ReadonlyArray<string>;
  readonly grade: 'A' | 'B' | 'C' | 'F';
  readonly gradeLabelRu: string;
}

export type Scenario4TargetKind =
  | 'extinguisher'
  | 'entrance'
  | 'fire'
  | 'emergency_op'
  | 'npc'
  | 'assembly'
  | 'completed';

export interface Scenario4NavTargetItem {
  readonly id: string;
  readonly kind: Scenario4TargetKind;
  readonly labelRu: string;
  readonly buildingLabelRu: string | null;
  readonly distanceM: number;
  readonly relativeBearingDeg: number;
  readonly statusRu: string;
}

export interface Scenario4NavigationSnapshot {
  readonly markersVisible: boolean;
  readonly priorityTarget: Scenario4NavTargetItem | null;
  readonly activeBuildingAlerts: ReadonlyArray<string>;
}

export interface Scenario4HudSnapshot {
  readonly isLoadingGlb: boolean;
  readonly loadProgressPct: number;
  readonly loadStatusRu: string;
  readonly loadErrorRu: string | null;
  readonly inspectionReport: NppInspectionReport | null;
  readonly stepId: Scenario4PhaseId;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly stepTitleRu: string;
  readonly instructionRu: string;
  readonly firesExtinguished: number;
  readonly totalFires: number;
  readonly rescuedCount: number;
  readonly totalNpcCount: number;
  readonly extinguisherStatus: ExtinguisherStatus;
  readonly extinguisherLifecycleState: ExtinguisherLifecycleState;
  readonly extinguisherChargePct: number;
  readonly isSpraying: boolean;
  readonly isInsideBuilding: boolean;
  readonly inAssemblyZone: boolean;
  readonly thermalHeatLoad01: number;
  readonly smokeExposure01: number;
  readonly elapsedSec: number;
  readonly maxDurationSec: number;
  readonly cumulativeDoseMsv: number;
  readonly doseLimitMsv: number;
  readonly installedEquipmentCount: number;
  readonly vehicle: MchsVehicleSnapshot;
  readonly emergencyOps: EmergencyOpsSnapshot;
  readonly navigation: Scenario4NavigationSnapshot;
  readonly activeInputLabelRu: string;
  readonly targetPromptRu: string | null;
  readonly warningBannerRu: string | null;
  readonly safetyErrorCount: number;
  readonly debrief: Scenario4DebriefSummary | null;
}

export class Scenario4StateMachine {
  private phase: Scenario4PhaseId = 'LOADING_ASSET';
  private safetyErrors: string[] = [];
  private warningBannerRu: string | null = null;
  private warningTimerSec = 0;
  private failureReasonRu: string | null = null;

  public getPhase(): Scenario4PhaseId {
    return this.phase;
  }

  public getMeta(): Scenario4PhaseMeta {
    return SCENARIO4_PHASES[this.phase];
  }

  public getWarningBanner(): string | null {
    return this.warningBannerRu;
  }

  public getSafetyErrors(): ReadonlyArray<string> {
    return this.safetyErrors;
  }

  public getFailureReason(): string | null {
    return this.failureReasonRu;
  }

  public markAssetReady(): void {
    if (this.phase === 'LOADING_ASSET') {
      this.phase = 'BRIEFING_ENTRY';
    }
  }

  public pushWarning(messageRu: string, recordAsSafetyError = false): void {
    this.warningBannerRu = messageRu;
    this.warningTimerSec = 4.5;
    if (recordAsSafetyError && !this.safetyErrors.includes(messageRu)) {
      this.safetyErrors.push(messageRu);
    }
  }

  public tick(dt: number): void {
    if (this.warningTimerSec > 0) {
      this.warningTimerSec = Math.max(0, this.warningTimerSec - dt);
      if (this.warningTimerSec <= 0) {
        this.warningBannerRu = null;
      }
    }
  }

  public evaluateProgression(params: {
    assetReady: boolean;
    isSuppressionReady: boolean;
    isInsideBuilding: boolean;
    allFiresExtinguished: boolean;
    allEmergencyOpsDone: boolean;
    allNpcsSafe: boolean;
    inAssemblyZone: boolean;
    elapsedSec: number;
    maxDurationSec: number;
    cumulativeDoseMsv: number;
    doseLimitMsv: number;
  }): Scenario4PhaseId | null {
    const prev = this.phase;

    if (this.phase === 'COMPLETED' || this.phase === 'FAILED') {
      return null;
    }

    if (this.phase === 'LOADING_ASSET') {
      if (params.assetReady) {
        this.phase = 'BRIEFING_ENTRY';
      }
      return this.phase !== prev ? this.phase : null;
    }

    // Проверка критических нормативов безопасности ALARA / времени
    if (params.cumulativeDoseMsv >= params.doseLimitMsv) {
      this.failureReasonRu = `Превышен предел дозы НРБ-99/2009 (${params.doseLimitMsv.toFixed(2)} мЗв)!`;
      this.pushWarning(this.failureReasonRu, true);
      this.phase = 'FAILED';
      return this.phase;
    }

    if (params.elapsedSec >= params.maxDurationSec) {
      this.failureReasonRu = `Истёк норматив времени спасательной операции (${params.maxDurationSec} с)!`;
      this.pushWarning(this.failureReasonRu, true);
      this.phase = 'FAILED';
      return this.phase;
    }

    if (this.phase === 'BRIEFING_ENTRY') {
      if (params.isSuppressionReady && params.isInsideBuilding) {
        this.phase = 'FIRE_SUPPRESSION';
      }
    } else if (this.phase === 'FIRE_SUPPRESSION') {
      if (params.allFiresExtinguished) {
        this.phase = 'EVACUATION_ESCORT';
      }
    } else if (this.phase === 'EVACUATION_ESCORT') {
      if (
        params.allFiresExtinguished &&
        params.allEmergencyOpsDone &&
        params.allNpcsSafe &&
        params.inAssemblyZone
      ) {
        this.phase = 'COMPLETED';
      }
    }

    return this.phase !== prev ? this.phase : null;
  }

  public buildDebriefSummary(params: {
    outcome: 'COMPLETED' | 'FAILED';
    elapsedSec: number;
    rescuedCount: number;
    totalNpcCount: number;
    extinguishedFires: number;
    totalFires: number;
    remainingExtinguisherPct: number;
    cylindersUsed: number;
    radReconDone: boolean;
    loopIsolated: boolean;
    casualtyStabilized: boolean;
    usedHoseOrVehicle: boolean;
    cumulativeDoseMsv: number;
    peakHeatLoadPct: number;
  }): Scenario4DebriefSummary {
    const errors = this.safetyErrors.length;
    let grade: 'A' | 'B' | 'C' | 'F' = 'A';
    let gradeLabelRu = 'ОТЛИЧНО • КЛАСС А (ALARA & ПТБ МЧС ВЫПОЛНЕНЫ)';

    if (params.outcome === 'FAILED') {
      grade = 'F';
      gradeLabelRu = `ОПЕРАЦИЯ ПРОВАЛЕНА • ${this.failureReasonRu ?? 'НАРУШЕНИЕ НОРМАТИВОВ'}`;
    } else if (errors >= 3 || params.cumulativeDoseMsv > 0.42 || params.peakHeatLoadPct > 85) {
      grade = 'C';
      gradeLabelRu = 'УДОВЛЕТВОРИТЕЛЬНО • ЗАМЕЧАНИЯ ПО ТБ МЧС';
    } else if (errors >= 1 || params.cumulativeDoseMsv > 0.25 || params.elapsedSec > 280) {
      grade = 'B';
      gradeLabelRu = 'ХОРОШО • КЛАСС B';
    }

    return {
      outcome: params.outcome,
      failureReasonRu: this.failureReasonRu,
      elapsedSec: params.elapsedSec,
      rescuedCount: params.rescuedCount,
      totalNpcCount: params.totalNpcCount,
      extinguishedFires: params.extinguishedFires,
      totalFires: params.totalFires,
      remainingExtinguisherPct: params.remainingExtinguisherPct,
      cylindersUsed: params.cylindersUsed,
      radReconDone: params.radReconDone,
      loopIsolated: params.loopIsolated,
      casualtyStabilized: params.casualtyStabilized,
      usedHoseOrVehicle: params.usedHoseOrVehicle,
      cumulativeDoseMsv: params.cumulativeDoseMsv,
      peakHeatLoadPct: params.peakHeatLoadPct,
      safetyErrors: [...this.safetyErrors],
      grade,
      gradeLabelRu
    };
  }

  public reset(): void {
    this.phase = 'LOADING_ASSET';
    this.safetyErrors = [];
    this.warningBannerRu = null;
    this.warningTimerSec = 0;
    this.failureReasonRu = null;
  }
}
