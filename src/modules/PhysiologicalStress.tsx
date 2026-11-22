/**
 * ALARA-Planner Pro — Симулятор физиологии, теплового и радиационно-психологического стресса спасателя
 * (src/modules/PhysiologicalStress.tsx)
 *
 * Моделирует в реальном времени состояние сердечно-сосудистой, дыхательной и терморегуляторной систем
 * оператора при работе в изолирующих средствах индивидуальной защиты (КИХ-4, ИЗК, РХБЗ-комплект)
 * в условиях повышенных мощностей доз и ограниченного запаса дыхательной смеси АСВ-2.
 */

import React, { useEffect, useRef } from 'react';
import {
  PPELoadoutState,
  SUIT_SPECIFICATIONS,
  RESPIRATOR_SPECIFICATIONS
} from './PPECheckModule';

export interface PhysiologicalTelemetry {
  /** Частота сердечных сокращений (60 - 195 уд/мин) */
  heartRateBpm: number;
  /** Частота дыхательных движений в маске (12 - 48 цикл/мин) */
  respirationRatePerMin: number;
  /** Сатурация артериальной крови кислородом SpO2 (82.0 - 100.0 %) */
  spO2Percent: number;
  /** Внутренняя температура тела в изолирующем костюме (36.6 - 40.5 °C) */
  coreBodyTempC: number;
  /** Индекс психофизиологического стресса / симпатоадреналовой реакции (0 - 100 %) */
  stressIndexPercent: number;
  /** Коэффициент запотевания панорамного стекла маски (0.0 - 1.0) */
  visorFoggingLevel: number;
  /** Амплитуда тремора рук оператора в метрах для манипуляторов VR (0.0 - 0.018 м) */
  handTremorAmplitudeM: number;
  /** Интенсивность периферического туннельного зрения при гипоксии/тахикардии (0.0 - 1.0) */
  tunnelVisionIntensity: number;
  /** Текущий расход воздуха в литрах в минуту (л/мин) */
  airConsumptionLitersPerMin: number;
  /** Остаток дыхательной смеси / ресурса фильтра (%) */
  remainingOxygenPercent: number;
  /** Статус физиологического состояния */
  clinicalStatus: 'OPTIMAL' | 'COMPENSATED_STRAIN' | 'THERMAL_HYPOXIC_STRESS' | 'CRITICAL_COLLAPSE';
}

export interface PhysiologicalStressProps {
  /** Текущее состояние СИЗ спасателя */
  ppeState: PPELoadoutState;
  /** Текущая мощность эквивалентной дозы в точке нахождения спасателя (мЗв/ч) */
  currentDoseRateMsvPerHour: number;
  /** Накопленная эквивалентная доза за смену (мЗв) */
  accumulatedDoseMsv: number;
  /** Признак физической нагрузки (перемещение, перенос свинцовых экранов или работа в приседе) */
  isPhysicalExertion: boolean;
  /** Температура окружающей среды в помещении ЧС (°C, по умолчанию 24 °C, в реакторном зале до 45 °C) */
  ambientTemperatureC?: number;
  /** Коэффициент снижения стресса от роли звена РХБЗ (по умолчанию 1.0) */
  stressDampingFactor?: number;
  /** Задымление среды (0..1), снижающее SpO2 при отсутствии изолирующего СИЗОД */
  smokeExposure01?: number;
  /** Коллбэк обновления биометрической телеметрии */
  onUpdateTelemetry?: (telemetry: PhysiologicalTelemetry) => void;
  /** Коллбэк обновления остатка кислорода в состоянии СИЗ */
  onOxygenDepletion?: (remainingPercent: number, pressureMpa: number) => void;
}

/**
 * Чистая функция расчета шага биометрической модели спасателя за интервал dt (сек)
 */
export function stepPhysiologicalModel(
  prev: PhysiologicalTelemetry,
  ppeState: PPELoadoutState,
  currentDoseRateMsvPerHour: number,
  accumulatedDoseMsv: number,
  isPhysicalExertion: boolean,
  ambientTemperatureC: number,
  dtSec: number,
  stressDampingFactor: number = 1.0,
  smokeExposure01: number = 0.0
): PhysiologicalTelemetry {
  const suitSpec = SUIT_SPECIFICATIONS[ppeState.suitType] || SUIT_SPECIFICATIONS.NONE;
  const respSpec = RESPIRATOR_SPECIFICATIONS[ppeState.respiratorType] || RESPIRATOR_SPECIFICATIONS.NONE;
  const isAmbientOpenAir = ppeState.respiratorType === 'NONE';

  // 1. Расчет психоэмоционального стресса от радиационной обстановки и нехватки воздуха
  const doseRateStress = Math.min(45.0, Math.log10(1.0 + currentDoseRateMsvPerHour * 12.0) * 18.0);
  const accumulatedDoseStress = Math.min(25.0, accumulatedDoseMsv * 0.8);
  const hypoxiaStress =
    !isAmbientOpenAir && prev.remainingOxygenPercent < 25.0
      ? ((25.0 - prev.remainingOxygenPercent) / 25.0) * 40.0
      : smokeExposure01 * (1.0 / Math.max(1.0, respSpec.inhalationProtectionFactor * 0.02)) * 28.0;
  const breachStress =
    ppeState.suitType !== 'NONE' && ppeState.suitIntegrity < 0.9
      ? (1.0 - ppeState.suitIntegrity) * 60.0
      : 0.0;

  const targetStress = Math.min(
    100.0,
    Math.max(
      5.0,
      (doseRateStress + accumulatedDoseStress + hypoxiaStress + breachStress) *
        Math.max(0.5, Math.min(1.2, stressDampingFactor))
    )
  );
  const stressIndexPercent = prev.stressIndexPercent + (targetStress - prev.stressIndexPercent) * Math.min(1.0, dtSec * 0.8);

  // 2. Внутренняя температура тела (эндогенное теплообразование в герметичном скафандре)
  const metabolicHeatRate = isPhysicalExertion ? 0.0014 : 0.00045;
  const ambientDelta = Math.max(0.0, (ambientTemperatureC - 22.0) * 0.00018);
  const coolingRate = (prev.coreBodyTempC - 36.65) * (0.015 / suitSpec.thermalInsulationFactor);

  const nextCoreTemp = Math.min(
    40.5,
    Math.max(
      36.6,
      prev.coreBodyTempC +
        (metabolicHeatRate * suitSpec.thermalInsulationFactor + ambientDelta - coolingRate) * dtSec
    )
  );

  // 3. Целевая частота сердечных сокращений (ЧСС) с учетом массы СИЗ, перегрева и стресса
  const restingBpm = 68.0;
  const suitLoadBpm = suitSpec.massKg * 1.15 + ( isPhysicalExertion ? 28.0 : 6.0 );
  const thermalDriftBpm = Math.max(0.0, (nextCoreTemp - 37.0) * 18.5);
  const stressBpm = (stressIndexPercent / 100.0) * 48.0;

  const targetBpm = Math.min(195.0, restingBpm + suitLoadBpm + thermalDriftBpm + stressBpm);
  const heartRateBpm = prev.heartRateBpm + (targetBpm - prev.heartRateBpm) * Math.min(1.0, dtSec * 0.6);

  // 4. Частота дыхания и расход воздуха из баллонов АСВ-2 / ресурса ФПК
  const targetRespirationRate = Math.min(
    48.0,
    14.0 + ((heartRateBpm - 68.0) / 120.0) * 26.0 + (hypoxiaStress > 0 ? 8.0 : 0.0)
  );
  const respirationRatePerMin =
    prev.respirationRatePerMin + (targetRespirationRate - prev.respirationRatePerMin) * Math.min(1.0, dtSec * 0.9);

  // Легочная вентиляция (л/мин): от 18 л/мин в покое до 75 л/мин при тяжелой работе
  const airConsumptionLitersPerMin = Number((respirationRatePerMin * 1.45).toFixed(1));

  // Списание запаса кислорода / ресурса фильтра (без СИЗОД — неограниченный атмосферный воздух)
  const nominalSeconds = Math.max(60.0, respSpec.nominalDurationMinutes * 60.0);
  const workloadMultiplier = airConsumptionLitersPerMin / 30.0;
  const depletionPerSec = isAmbientOpenAir ? 0.0 : (100.0 / nominalSeconds) * workloadMultiplier;
  const remainingOxygenPercent = isAmbientOpenAir
    ? 100.0
    : Math.max(0.0, prev.remainingOxygenPercent - depletionPerSec * dtSec);

  // 5. Сатурация SpO2 (%) — учитывает как остаток баллона, так и дым без СИЗОД
  const smokeHypoxiaDrop =
    ppeState.respiratorType === 'NONE'
      ? smokeExposure01 * 11.0
      : ppeState.respiratorType === 'DP_5_RESP'
      ? smokeExposure01 * 4.5
      : 0.0;
  const targetSpO2 =
    remainingOxygenPercent > 15.0
      ? 98.5 - Math.max(0.0, (heartRateBpm - 140.0) * 0.05) - smokeHypoxiaDrop
      : 82.0 + (remainingOxygenPercent / 15.0) * 14.0 - smokeHypoxiaDrop;
  const spO2Percent = prev.spO2Percent + (targetSpO2 - prev.spO2Percent) * Math.min(1.0, dtSec * 0.5);

  // 6. Запотевание панорамного стекла маски, тремор рук и туннельное зрение
  const visorFoggingLevel = Number(
    Math.min(
      0.92,
      Math.max(
        0.04,
        ((respirationRatePerMin - 14.0) / 34.0) * 0.55 +
          ((nextCoreTemp - 36.6) / 3.5) * 0.35
      )
    ).toFixed(3)
  );

  const handTremorAmplitudeM = Number(
    Math.min(
      0.018,
      Math.max(
        0.0004,
        ((heartRateBpm - 75.0) / 120.0) * 0.008 +
          (stressIndexPercent / 100.0) * 0.007 +
          (spO2Percent < 92.0 ? 0.005 : 0.0)
      )
    ).toFixed(5)
  );

  const tunnelVisionIntensity = Number(
    Math.min(
      0.85,
      Math.max(
        0.0,
        ((heartRateBpm - 135.0) / 60.0) * 0.45 +
          ((95.0 - spO2Percent) / 13.0) * 0.55
      )
    ).toFixed(3)
  );

  let clinicalStatus: PhysiologicalTelemetry['clinicalStatus'] = 'OPTIMAL';
  if (heartRateBpm > 170 || spO2Percent < 88 || nextCoreTemp >= 39.2 || remainingOxygenPercent < 8) {
    clinicalStatus = 'CRITICAL_COLLAPSE';
  } else if (heartRateBpm > 140 || spO2Percent < 93 || nextCoreTemp >= 38.3 || remainingOxygenPercent < 20) {
    clinicalStatus = 'THERMAL_HYPOXIC_STRESS';
  } else if (heartRateBpm > 105 || stressIndexPercent > 40) {
    clinicalStatus = 'COMPENSATED_STRAIN';
  }

  return {
    heartRateBpm: Number(heartRateBpm.toFixed(1)),
    respirationRatePerMin: Number(respirationRatePerMin.toFixed(1)),
    spO2Percent: Number(spO2Percent.toFixed(1)),
    coreBodyTempC: Number(nextCoreTemp.toFixed(2)),
    stressIndexPercent: Number(stressIndexPercent.toFixed(1)),
    visorFoggingLevel,
    handTremorAmplitudeM,
    tunnelVisionIntensity,
    airConsumptionLitersPerMin,
    remainingOxygenPercent: Number(remainingOxygenPercent.toFixed(2)),
    clinicalStatus
  };
}

/**
 * React-компонент непрерывного расчета физиологического стресса спасателя
 */
export const PhysiologicalStress: React.FC<PhysiologicalStressProps> = ({
  ppeState,
  currentDoseRateMsvPerHour,
  accumulatedDoseMsv,
  isPhysicalExertion,
  ambientTemperatureC = 25.0,
  stressDampingFactor = 1.0,
  smokeExposure01 = 0.0,
  onUpdateTelemetry,
  onOxygenDepletion
}) => {
  const telemetryRef = useRef<PhysiologicalTelemetry>({
    heartRateBpm: 74.0,
    respirationRatePerMin: 15.0,
    spO2Percent: 98.4,
    coreBodyTempC: 36.75,
    stressIndexPercent: 12.0,
    visorFoggingLevel: 0.08,
    handTremorAmplitudeM: 0.0006,
    tunnelVisionIntensity: 0.0,
    airConsumptionLitersPerMin: 21.8,
    remainingOxygenPercent: ppeState.oxygenOrFilterReservePercent,
    clinicalStatus: 'OPTIMAL'
  });

  // Синхронизация при внешней перезарядке баллона АСВ-2 или смене СИЗОД
  useEffect(() => {
    if (Math.abs(ppeState.oxygenOrFilterReservePercent - telemetryRef.current.remainingOxygenPercent) > 3.0) {
      telemetryRef.current.remainingOxygenPercent = ppeState.oxygenOrFilterReservePercent;
    }
  }, [ppeState.oxygenOrFilterReservePercent, ppeState.respiratorType]);

  const latestPropsRef = useRef({
    ppeState,
    currentDoseRateMsvPerHour,
    accumulatedDoseMsv,
    isPhysicalExertion,
    ambientTemperatureC,
    stressDampingFactor,
    smokeExposure01,
    onUpdateTelemetry,
    onOxygenDepletion
  });
  latestPropsRef.current = {
    ppeState,
    currentDoseRateMsvPerHour,
    accumulatedDoseMsv,
    isPhysicalExertion,
    ambientTemperatureC,
    stressDampingFactor,
    smokeExposure01,
    onUpdateTelemetry,
    onOxygenDepletion
  };

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const props = latestPropsRef.current;
      const next = stepPhysiologicalModel(
        telemetryRef.current,
        props.ppeState,
        props.currentDoseRateMsvPerHour,
        props.accumulatedDoseMsv,
        props.isPhysicalExertion,
        props.ambientTemperatureC,
        0.5,
        props.stressDampingFactor,
        props.smokeExposure01
      );
      telemetryRef.current = next;

      if (props.onUpdateTelemetry) {
        props.onUpdateTelemetry(next);
      }
      if (props.onOxygenDepletion) {
        const nextPressureMpa =
          props.ppeState.respiratorType === 'ASV_2'
            ? Number(((next.remainingOxygenPercent / 100.0) * 29.4).toFixed(2))
            : props.ppeState.respiratorType === 'NONE'
            ? 0.0
            : 1.0;
        props.onOxygenDepletion(next.remainingOxygenPercent, nextPressureMpa);
      }
    }, 500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, []);

  return null;
};

export default PhysiologicalStress;
