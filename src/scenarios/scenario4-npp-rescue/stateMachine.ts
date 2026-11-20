/**
 * 6-шаговый конечный автомат (State Machine) Сценария №4 МЧС АЭС
 */

import { SCENARIO4_STEPS, Scenario4DebriefSummary, Scenario4StepId } from './config';

export class Scenario4StateMachine {
  private step: Scenario4StepId = 'STEP_1_PREP_ENTRY';
  private safetyErrors: string[] = [];
  private warningBannerRu: string | null = null;
  private warningTimerSec = 0;

  public getStep(): Scenario4StepId {
    return this.step;
  }

  public getMeta() {
    return SCENARIO4_STEPS[this.step];
  }

  public getWarningBanner(): string | null {
    return this.warningBannerRu;
  }

  public getSafetyErrors(): ReadonlyArray<string> {
    return this.safetyErrors;
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
    isExtinguisherArmed: boolean;
    isInsideBuilding: boolean;
    fire1Extinguished: boolean;
    group1StartedOrEvacuated: boolean;
    allFiresExtinguished: boolean;
    allNpcsEvacuated: boolean;
    inAssemblyZone: boolean;
  }): Scenario4StepId | null {
    const prev = this.step;

    if (this.step === 'STEP_1_PREP_ENTRY') {
      if (params.isExtinguisherArmed && params.isInsideBuilding) {
        this.step = 'STEP_2_FIRE_1';
      }
    } else if (this.step === 'STEP_2_FIRE_1') {
      if (params.fire1Extinguished) {
        this.step = 'STEP_3_EVAC_1';
      }
    } else if (this.step === 'STEP_3_EVAC_1') {
      if (params.group1StartedOrEvacuated) {
        this.step = 'STEP_4_FIRE_2_EVAC_2';
      }
    } else if (this.step === 'STEP_4_FIRE_2_EVAC_2') {
      if (params.allFiresExtinguished && params.allNpcsEvacuated) {
        this.step = 'STEP_5_FINAL_SWEEP';
      }
    } else if (this.step === 'STEP_5_FINAL_SWEEP') {
      if (params.allFiresExtinguished && params.allNpcsEvacuated && params.inAssemblyZone) {
        this.step = 'STEP_6_DEBRIEF';
      }
    }

    return this.step !== prev ? this.step : null;
  }

  public buildDebriefSummary(params: {
    elapsedSec: number;
    rescuedCount: number;
    totalNpcCount: number;
    extinguishedFires: number;
    totalFires: number;
    remainingExtinguisherPct: number;
    cylindersUsed: number;
    cumulativeDoseMsv: number;
    peakHeatLoadPct: number;
  }): Scenario4DebriefSummary {
    const errors = this.safetyErrors.length;
    let grade: 'A' | 'B' | 'C' = 'A';
    let gradeLabelRu = 'ОТЛИЧНО • КЛАСС А (ALARA & ПТБ МЧС ВЫПОЛНЕНЫ)';

    if (errors >= 3 || params.cumulativeDoseMsv > 0.45 || params.peakHeatLoadPct > 85) {
      grade = 'C';
      gradeLabelRu = 'УДОВЛЕТВОРИТЕЛЬНО • ЗАМЕЧАНИЯ ПО ТБ МЧС';
    } else if (errors >= 1 || params.cumulativeDoseMsv > 0.25 || params.elapsedSec > 260) {
      grade = 'B';
      gradeLabelRu = 'ХОРОШО • КЛАСС B';
    }

    return {
      elapsedSec: params.elapsedSec,
      rescuedCount: params.rescuedCount,
      totalNpcCount: params.totalNpcCount,
      extinguishedFires: params.extinguishedFires,
      totalFires: params.totalFires,
      remainingExtinguisherPct: params.remainingExtinguisherPct,
      cylindersUsed: params.cylindersUsed,
      cumulativeDoseMsv: params.cumulativeDoseMsv,
      peakHeatLoadPct: params.peakHeatLoadPct,
      safetyErrors: [...this.safetyErrors],
      grade,
      gradeLabelRu
    };
  }

  public reset(): void {
    this.step = 'STEP_1_PREP_ENTRY';
    this.safetyErrors = [];
    this.warningBannerRu = null;
    this.warningTimerSec = 0;
  }
}
