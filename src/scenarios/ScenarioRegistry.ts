/**
 * ALARA-Planner Pro — Реестр 4 оперативных сценариев ликвидации радиационных ЧС
 * (src/scenarios/ScenarioRegistry.ts)
 */

import { ScenarioData } from './types';

export const SCENARIO_REGISTRY: Readonly<Record<number, ScenarioData>> = {
  // ==========================================================================
  // СЦЕНАРИЙ 01: Разгерметизация реакторного зала АЭС
  // ==========================================================================
  1: {
    id: 1,
    codeName: 'NPP_REACTOR_HALL_RUPTURE',
    title: '01. Разгерметизация реакторного зала АЭС (Фрагменты ТВС и графита, Cs-137 / I-131)',
    category: 'NPP',
    description:
      'Тепловой выброс в центральном зале энергоблока с выбросом фрагментов тепловыделяющих сборок и реакторного графита. В эпицентре у развала ТВС мощность дозы превышает 100 Гр/ч. Требуется провести разведку из-за теневой биозащиты и локализовать высокоактивные обломки.',
    playerStartPosition: [0, 1.65, 4.5],
    doseLimitMsv: 20.0,
    maxDurationSec: 180,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.4,
      windDirectionRad: 0.25,
      stabilityClass: 'D',
      ambientTemperatureC: 42,
      humidityPercent: 78,
      isLowLightEmergency: true,
      visibilityRangeMeters: 12.0
    },
    hazards: [
      {
        id: 'sc01_fuel_assembly_core',
        nameRu: 'Разрушенный фрагмент ТВС с свечением Вавилова — Черенкова',
        type: 'point_source',
        position: [0.0, 0.35, -3.8],
        activityGbk: 1250000.0, // Экстремальная активность, формирующая поле > 100 Гр/ч вблизи
        radionuclideKey: 'Cs-137',
        materialShieldKey: 'heavy_concrete',
        shieldThicknessCm: 18.0,
        geometryData: {
          archetype: 'fuel_assembly_fragment',
          dimensionsMeters: [0.45, 0.28, 1.1],
          rotationEulerRad: [0.15, 0.6, 1.42],
          primaryColorHex: 0x334155,
          emissiveColorHex: 0x38bdf8,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 1.05
        }
      },
      {
        id: 'sc01_graphite_debris_cluster',
        nameRu: 'Обломки облученного реакторного графита',
        type: 'debris',
        position: [-1.15, 0.14, -2.7],
        activityGbk: 48000.0,
        radionuclideKey: 'Co-60',
        geometryData: {
          archetype: 'graphite_block',
          dimensionsMeters: [0.32, 0.22, 0.36],
          rotationEulerRad: [0.0, 0.85, 0.0],
          primaryColorHex: 0x18181b,
          emissiveColorHex: 0x0284c7,
          hasCherenkovGlow: false
        }
      },
      {
        id: 'sc01_iodine_aerosol_plume',
        nameRu: 'Парогазовый выброс летучего йода-131 из канала ГЦК',
        type: 'plume',
        position: [0.45, 0.5, -3.5],
        activityGbk: 85000.0,
        radionuclideKey: 'I-131',
        geometryData: {
          archetype: 'high_pressure_steam_valve',
          dimensionsMeters: [0.4, 0.5, 0.4],
          primaryColorHex: 0x475569,
          plumeConfig: {
            plumeLengthMeters: 5.8,
            releaseHeightMeters: 0.55,
            aerosolColorHex: 0x94a3b8,
            baseOpacity: 0.30
          }
        }
      }
    ],
    objectives: [
      {
        id: 'sc01_obj_1_recon',
        description: 'Провести картографирование градиента МЭД у барьера биозащиты центрального зала',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 50,
        doseLimitMsv: 5.0,
        targetEntityId: 'sc01_graphite_debris_cluster',
        requiredProximityMeters: 3.2
      },
      {
        id: 'sc01_obj_2_shield',
        description: 'Установить свинцово-баритовый теневой экран на направлении главного пучка от фрагмента ТВС',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 115,
        doseLimitMsv: 12.0,
        targetEntityId: 'sc01_fuel_assembly_core',
        requiredProximityMeters: 2.8
      },
      {
        id: 'sc01_obj_3_contain',
        description: 'Дистанционным захватом переместить графитовый фрагмент в защитный контейнер ТУК',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 180,
        doseLimitMsv: 20.0,
        targetEntityId: 'sc01_graphite_debris_cluster',
        requiredProximityMeters: 2.2
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 02: Порыв контура теплоносителя исследовательского реактора
  // ==========================================================================
  2: {
    id: 2,
    codeName: 'RESEARCH_REACTOR_COOLANT_STEAM_LEAK',
    title: '02. Порыв контура теплоносителя ИЯУ (Активный пар N-16 и Na-24, минимальная видимость)',
    category: 'NPP',
    description:
      'Разрыв фланцевого соединения трубопровода первого контура исследовательского реактора. Бокс заполнен плотным горячим паром с короткоживущим азотом-16 (6.13 МэВ) и натрием-24. Требуется с использованием тактического фонаря перекрыть секущую задвижку.',
    playerStartPosition: [0, 1.65, 4.2],
    doseLimitMsv: 5.0,
    maxDurationSec: 150,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 2.6,
      windDirectionRad: 0.0,
      stabilityClass: 'C',
      ambientTemperatureC: 58,
      humidityPercent: 98,
      isLowLightEmergency: true,
      visibilityRangeMeters: 3.5
    },
    hazards: [
      {
        id: 'sc02_n16_steam_manifold',
        nameRu: 'Свищ главного пароводяного коллектора 1-го контура (N-16)',
        type: 'leak_valve',
        position: [0.25, 1.35, -3.2],
        activityGbk: 6400.0,
        radionuclideKey: 'N-16',
        materialShieldKey: 'steel',
        shieldThicknessCm: 2.5,
        geometryData: {
          archetype: 'high_pressure_steam_valve',
          dimensionsMeters: [0.55, 0.65, 0.55],
          primaryColorHex: 0x64748b,
          emissiveColorHex: 0x38bdf8,
          plumeConfig: {
            plumeLengthMeters: 6.8,
            releaseHeightMeters: 1.25,
            aerosolColorHex: 0xe2e8f0,
            baseOpacity: 0.42
          }
        }
      },
      {
        id: 'sc02_na24_coolant_puddle',
        nameRu: 'Конденсат активированного теплоносителя (Na-24) в приямке',
        type: 'point_source',
        position: [-0.4, 0.05, -2.9],
        activityGbk: 1850.0,
        radionuclideKey: 'Na-24',
        geometryData: {
          archetype: 'radiochem_puddle',
          dimensionsMeters: [1.8, 0.03, 1.8],
          primaryColorHex: 0x0ea5e9,
          emissiveColorHex: 0x0284c7,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 0.65
        }
      }
    ],
    objectives: [
      {
        id: 'sc02_obj_1_locate_flange',
        description: 'Высветить лучом тактического фонаря (эффект Тиндаля) эпицентр парового выброса',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 45,
        doseLimitMsv: 1.5,
        targetEntityId: 'sc02_n16_steam_manifold',
        requiredProximityMeters: 3.5
      },
      {
        id: 'sc02_obj_2_shut_valve',
        description: 'Перекрыть дублирующий запорный вентиль контура для прекращения поступления N-16',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 100,
        doseLimitMsv: 3.5,
        targetEntityId: 'sc02_n16_steam_manifold',
        requiredProximityMeters: 1.8
      },
      {
        id: 'sc02_obj_3_verify_decay',
        description: 'Подтвердить спад мощности дозы после распада короткоживущего азота-16 (T1/2 = 7.13 с)',
        status: 'pending',
        criticality: 'medium',
        timeThresholdSec: 150,
        doseLimitMsv: 5.0,
        targetEntityId: 'sc02_na24_coolant_puddle',
        requiredProximityMeters: 2.5
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 03: ЧС в радиологическом центре (Co-60)
  // ==========================================================================
  3: {
    id: 3,
    codeName: 'MEDICAL_RADIOTHERAPY_CO60_JAM',
    title: '03. ЧС в радиологическом центре (Заклинивание затвора гамма-аппарата Co-60)',
    category: 'Medical',
    description:
      'В каньоне дистанционной лучевой терапии произошло заклинивание шиберного затвора облучательной головки с источником кобальта-60 в открытом положении. Требуется с использованием свинцовой ширмы и манипулятора перевести капсулу в контейнер хранения.',
    playerStartPosition: [0, 1.65, 4.0],
    doseLimitMsv: 2.0,
    maxDurationSec: 160,
    requireHazmatPpe: false,
    atmosphere: {
      windSpeedMps: 0.4,
      windDirectionRad: 0.0,
      stabilityClass: 'E',
      ambientTemperatureC: 21,
      humidityPercent: 45,
      isLowLightEmergency: false,
      visibilityRangeMeters: 25.0
    },
    hazards: [
      {
        id: 'sc03_co60_teletherapy_capsule',
        nameRu: 'Неэкранированная капсула источника ГИК-9 (Co-60)',
        type: 'point_source',
        position: [0.0, 1.15, -3.2],
        activityGbk: 3200.0,
        radionuclideKey: 'Co-60',
        materialShieldKey: 'lead',
        shieldThicknessCm: 4.5,
        geometryData: {
          archetype: 'sealed_isotope_capsule',
          dimensionsMeters: [0.08, 0.18, 0.08],
          primaryColorHex: 0x94a3b8,
          emissiveColorHex: 0x38bdf8,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 0.55
        }
      }
    ],
    objectives: [
      {
        id: 'sc03_obj_1_deploy_lead',
        description: 'Выдвинуть передвижную свинцовую ширму (50 мм Pb) на линию прямого пучка Co-60',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 50,
        doseLimitMsv: 0.7,
        targetEntityId: 'sc03_co60_teletherapy_capsule',
        requiredProximityMeters: 2.8
      },
      {
        id: 'sc03_obj_2_extract_capsule',
        description: 'Захватить капсулу ГИК-9 штанговым манипулятором ЦМ-1.5, исключая контактный хват',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 110,
        doseLimitMsv: 1.4,
        targetEntityId: 'sc03_co60_teletherapy_capsule',
        requiredProximityMeters: 1.8
      },
      {
        id: 'sc03_obj_3_seal_container',
        description: 'Поместить источник Co-60 в транспортно-перезарядочный контейнер КТП и закрыть пробку',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 160,
        doseLimitMsv: 2.0,
        targetEntityId: 'sc03_co60_teletherapy_capsule',
        requiredProximityMeters: 2.2
      }
    ]
  },
  // ==========================================================================
  // СЦЕНАРИЙ 04: Комплексный VR-тренажёр МЧС на 3D-модели АЭС (.glb)
  // ==========================================================================
  4: {
    id: 4,
    codeName: "MCHS_NPP_COMPLEX_GLB_RESCUE",
    title: "04. МЧС АЭС: Пожар и эвакуация персонала в комплексе АЭС (.glb)",
    category: "NPP",
    description:
      "Комплексная операция подразделений МЧС на 3D-модели комплекса АЭС (.glb): подготовка ОУ-5, вход в здание, поочерёдное тушение очагов возгорания, эвакуация персонала и выход на пункт сбора.",
    playerStartPosition: [0, 1.65, 21.5],
    doseLimitMsv: 0.50,
    maxDurationSec: 450,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.5,
      windDirectionRad: 0.35,
      stabilityClass: "D",
      ambientTemperatureC: 28,
      humidityPercent: 60,
      isLowLightEmergency: false,
      visibilityRangeMeters: 48.0
    },
    hazards: [
      {
        id: "sc04_npp_zone1",
        nameRu: "Очаг возгорания в электрощитовом отсеке (¹³⁷Cs)",
        type: "point_source",
        position: [-7.5, 0.8, 1.5],
        activityGbk: 0.45,
        radionuclideKey: "Cs-137",
        geometryData: {
          archetype: "tuk_transport_cask",
          dimensionsMeters: [1.0, 1.0, 1.0],
          primaryColorHex: 0x334155,
          emissiveColorHex: 0xf97316
        }
      }
    ],
    objectives: [
      {
        id: "sc04_obj_rescue_all",
        description: "Потушить все очаги пожара, эвакуировать персонал и выйти на Пункт сбора МЧС",
        status: "pending",
        criticality: "critical",
        timeThresholdSec: 450,
        doseLimitMsv: 0.50,
        targetEntityId: "sc04_npp_zone1",
        requiredProximityMeters: 4.0
      }
    ]
  }
};

export function getScenarioDataById(scenarioId: number): ScenarioData {
  return SCENARIO_REGISTRY[scenarioId] ?? SCENARIO_REGISTRY[1];
}

export function getAllScenarioDataList(): ScenarioData[] {
  return Object.values(SCENARIO_REGISTRY);
}
