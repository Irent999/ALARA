/**
 * ALARA-Planner Pro — Полный реестр 12 сценариев ликвидации радиационных ЧС
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
  // СЦЕНАРИЙ 04: Пожар на складе ТРО и ЖРО (Pu-239)
  // ==========================================================================
  4: {
    id: 4,
    codeName: 'RADWASTE_STORAGE_FIRE_PU239',
    title: '04. Пожар в хранилище ТРО и ЖРО (Термическая разгерметизация бочек, аэрозоль Pu-239)',
    category: 'Industrial',
    description:
      'Возгорание битумированных компаундов в ангаре временного хранения твердых и жидких радиоактивных отходов. Образуется плотный дымовой шлейф с альфа-активными аэрозолями плутония-239 и цезия-137.',
    playerStartPosition: [0, 1.65, 4.3],
    doseLimitMsv: 1.5,
    maxDurationSec: 180,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.9,
      windDirectionRad: -0.35,
      stabilityClass: 'C',
      ambientTemperatureC: 48,
      humidityPercent: 30,
      isLowLightEmergency: true,
      visibilityRangeMeters: 5.0
    },
    hazards: [
      {
        id: 'sc04_pu239_smoke_plume',
        nameRu: 'Дымовой факел аварийной бочки ТРО с аэрозолем Pu-239',
        type: 'plume',
        position: [-0.6, 0.45, -3.3],
        activityGbk: 2800.0,
        radionuclideKey: 'Pu-239',
        geometryData: {
          archetype: 'corroded_waste_drum',
          dimensionsMeters: [0.62, 0.92, 0.62],
          primaryColorHex: 0xd97706,
          emissiveColorHex: 0xef4444,
          plumeConfig: {
            plumeLengthMeters: 6.2,
            releaseHeightMeters: 0.85,
            aerosolColorHex: 0x64748b,
            baseOpacity: 0.38
          }
        }
      },
      {
        id: 'sc04_cs137_liquid_drum',
        nameRu: 'Поврежденная емкость ЖРО с концентратом Cs-137',
        type: 'point_source',
        position: [0.85, 0.45, -2.9],
        activityGbk: 1950.0,
        radionuclideKey: 'Cs-137',
        materialShieldKey: 'steel',
        shieldThicknessCm: 1.2,
        geometryData: {
          archetype: 'corroded_waste_drum',
          dimensionsMeters: [0.62, 0.92, 0.62],
          primaryColorHex: 0x475569
        }
      }
    ],
    objectives: [
      {
        id: 'sc04_obj_1_ppe_entry',
        description: 'Войти в задымленный отсек строго в изолирующем костюме и обнаружить очаг аэрозоля Pu-239',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 55,
        doseLimitMsv: 0.5,
        targetEntityId: 'sc04_pu239_smoke_plume',
        requiredProximityMeters: 3.0
      },
      {
        id: 'sc04_obj_2_suppress_plume',
        description: 'Активировать систему порошкового подавления и герметизирующий купол над бочкой ТРО',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 120,
        doseLimitMsv: 1.0,
        targetEntityId: 'sc04_pu239_smoke_plume',
        requiredProximityMeters: 1.9
      },
      {
        id: 'sc04_obj_3_shield_jro',
        description: 'Установить стальной защитный кожух вокруг поврежденной емкости ЖРО (Cs-137)',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 180,
        doseLimitMsv: 1.5,
        targetEntityId: 'sc04_cs137_liquid_drum',
        requiredProximityMeters: 2.0
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 05: Крушение спецпоезда с ОЯТ (ТУК)
  // ==========================================================================
  5: {
    id: 5,
    codeName: 'SPENT_FUEL_TRAIN_TUK_DERAILMENT',
    title: '05. Транспортная авария спецвагона с ОЯТ (Повреждение ТУК-13, нейтронно-гамма поле)',
    category: 'Industrial',
    description:
      'Сход спецплатформы при транспортировке отработавшего ядерного топлива. Ослаблена торцевая нейтронная защита контейнера ТУК-13, фиксируется локальный прострел смешанного гамма-нейтронного излучения (Cf-252 / Co-60).',
    playerStartPosition: [0, 1.65, 4.4],
    doseLimitMsv: 2.5,
    maxDurationSec: 190,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 3.1,
      windDirectionRad: 0.5,
      stabilityClass: 'D',
      ambientTemperatureC: 14,
      humidityPercent: 65,
      isLowLightEmergency: false,
      visibilityRangeMeters: 20.0
    },
    hazards: [
      {
        id: 'sc05_tuk13_neutron_beam',
        nameRu: 'Транспортный упаковочный комплект ТУК-13 с поврежденным демпфером',
        type: 'point_source',
        position: [0.0, 0.95, -3.4],
        activityGbk: 5400.0,
        radionuclideKey: 'Cf-252',
        materialShieldKey: 'steel',
        shieldThicknessCm: 8.0,
        geometryData: {
          archetype: 'tuk_transport_cask',
          dimensionsMeters: [1.15, 1.15, 2.45],
          rotationEulerRad: [0.0, 0.35, 1.57],
          primaryColorHex: 0x334155,
          emissiveColorHex: 0xf59e0b
        }
      },
      {
        id: 'sc05_co60_structural_leak',
        nameRu: 'Торцевой гамма-прострел кожуха ТУК-13 (Co-60)',
        type: 'point_source',
        position: [0.95, 0.85, -3.1],
        activityGbk: 2100.0,
        radionuclideKey: 'Co-60',
        materialShieldKey: 'lead',
        shieldThicknessCm: 3.5,
        geometryData: {
          archetype: 'sealed_isotope_capsule',
          dimensionsMeters: [0.18, 0.25, 0.18],
          primaryColorHex: 0x64748b
        }
      }
    ],
    objectives: [
      {
        id: 'sc05_obj_1_neutron_survey',
        description: 'Определить сектор торцевого нейтронного прострела у демпфера контейнера ТУК-13',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 60,
        doseLimitMsv: 0.8,
        targetEntityId: 'sc05_tuk13_neutron_beam',
        requiredProximityMeters: 3.2
      },
      {
        id: 'sc05_obj_2_water_poly_shield',
        description: 'Установить водородсодержащий защитный блок напротив поврежденного торца ТУК-13',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 130,
        doseLimitMsv: 1.7,
        targetEntityId: 'sc05_tuk13_neutron_beam',
        requiredProximityMeters: 2.1
      },
      {
        id: 'sc05_obj_3_seal_flange',
        description: 'Зафиксировать свинцовый компенсирующий бандаж на фланцевом стыке',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 190,
        doseLimitMsv: 2.5,
        targetEntityId: 'sc05_co60_structural_leak',
        requiredProximityMeters: 1.9
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 06: Утеря источника дефектоскопии (Ir-192)
  // ==========================================================================
  6: {
    id: 6,
    codeName: 'LOST_NDT_SOURCE_IR192_SEARCH',
    title: '06. Утеря источника гамма-дефектоскопии (Поиск капсулы Ir-192 на промплощадке)',
    category: 'Industrial',
    description:
      'Во время радиографического контроля сварных стыков трубопровода произошел обрыв троса управления дефектоскопа и выпадение ампулы иридия-192 в строительную траншею. Необходимо обнаружить капсулу по градиенту поля 1/r² и вернуть в защитный блок.',
    playerStartPosition: [0, 1.65, 4.2],
    doseLimitMsv: 1.0,
    maxDurationSec: 150,
    requireHazmatPpe: false,
    atmosphere: {
      windSpeedMps: 2.2,
      windDirectionRad: 0.8,
      stabilityClass: 'D',
      ambientTemperatureC: 12,
      humidityPercent: 55,
      isLowLightEmergency: false,
      visibilityRangeMeters: 30.0
    },
    hazards: [
      {
        id: 'sc06_ir192_dropped_capsule',
        nameRu: 'Выпавший держатель с источником ГИИД-3 (Ir-192)',
        type: 'point_source',
        position: [-0.75, 0.12, -2.8],
        activityGbk: 1450.0,
        radionuclideKey: 'Ir-192',
        geometryData: {
          archetype: 'sealed_isotope_capsule',
          dimensionsMeters: [0.06, 0.14, 0.06],
          primaryColorHex: 0xfacc15,
          emissiveColorHex: 0xeab308
        }
      }
    ],
    objectives: [
      {
        id: 'sc06_obj_1_locate_ir192',
        description: 'Методом триангуляции по закону обратных квадратов 1/r² обнаружить капсулу Ir-192',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 50,
        doseLimitMsv: 0.35,
        targetEntityId: 'sc06_ir192_dropped_capsule',
        requiredProximityMeters: 2.6
      },
      {
        id: 'sc06_obj_2_shield_trench',
        description: 'Установить переносной свинцовый коллиматор между оператором и найденной ампулой',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 100,
        doseLimitMsv: 0.65,
        targetEntityId: 'sc06_ir192_dropped_capsule',
        requiredProximityMeters: 2.0
      },
      {
        id: 'sc06_obj_3_recover_source',
        description: 'Телескопическим захватом (1.5 м) поместить источник Ir-192 в урановый блок БГИ',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 150,
        doseLimitMsv: 1.0,
        targetEntityId: 'sc06_ir192_dropped_capsule',
        requiredProximityMeters: 1.6
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 07: Авария на комбинате изотопов (Утечка UF6)
  // ==========================================================================
  7: {
    id: 7,
    codeName: 'ISOTOPE_PLANT_UF6_HYDROLYSIS',
    title: '07. Авария на разделительном производстве (Утечка гексафторида урана UF6)',
    category: 'Industrial',
    description:
      'Разгерметизация вентиля транспортного баллона с гексафторидом урана. При контакте с влагой воздуха образуется токсичное облако уранилфторида (UO₂F₂) и фтористого водорода (HF). Комбинированная химико-радиационная угроза.',
    playerStartPosition: [0, 1.65, 4.3],
    doseLimitMsv: 0.8,
    maxDurationSec: 165,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.5,
      windDirectionRad: 0.15,
      stabilityClass: 'D',
      ambientTemperatureC: 24,
      humidityPercent: 72,
      isLowLightEmergency: true,
      visibilityRangeMeters: 6.5
    },
    hazards: [
      {
        id: 'sc07_uf6_cylinder_valve',
        nameRu: 'Аварийный вентиль баллона UF₆ с гидролизным облаком UO₂F₂ + HF',
        type: 'leak_valve',
        position: [0.0, 0.95, -3.1],
        activityGbk: 820.0,
        radionuclideKey: 'UF6',
        materialShieldKey: 'steel',
        shieldThicknessCm: 1.6,
        geometryData: {
          archetype: 'high_pressure_steam_valve',
          dimensionsMeters: [0.48, 0.55, 0.48],
          primaryColorHex: 0x10b981,
          emissiveColorHex: 0x059669,
          plumeConfig: {
            plumeLengthMeters: 5.5,
            releaseHeightMeters: 0.9,
            aerosolColorHex: 0xd1fae5,
            baseOpacity: 0.35
          }
        }
      },
      {
        id: 'sc07_uranyl_puddle',
        nameRu: 'Конденсат плавиковой кислоты и уранилфторида на поддоне',
        type: 'point_source',
        position: [0.15, 0.03, -2.7],
        activityGbk: 410.0,
        radionuclideKey: 'UF6',
        geometryData: {
          archetype: 'radiochem_puddle',
          dimensionsMeters: [1.5, 0.02, 1.5],
          primaryColorHex: 0x10b981,
          emissiveColorHex: 0x047857
        }
      }
    ],
    objectives: [
      {
        id: 'sc07_obj_1_gas_check',
        description: 'Проконтролировать границы шлейфа гидролиза UF₆ в изолирующем комплекте СИЗ',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 50,
        doseLimitMsv: 0.25,
        targetEntityId: 'sc07_uf6_cylinder_valve',
        requiredProximityMeters: 3.0
      },
      {
        id: 'sc07_obj_2_band_clamp',
        description: 'Установить аварийный герметизирующий бандаж-колпак на штуцер баллона UF₆',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 110,
        doseLimitMsv: 0.55,
        targetEntityId: 'sc07_uf6_cylinder_valve',
        requiredProximityMeters: 1.7
      },
      {
        id: 'sc07_obj_3_neutralize',
        description: 'Локализовать химико-радиационный разлив сорбентом на поддоне',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 165,
        doseLimitMsv: 0.8,
        targetEntityId: 'sc07_uranyl_puddle',
        requiredProximityMeters: 2.0
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 08: Ликвидация дисперсного загрязнения в городской инфраструктуре
  // ==========================================================================
  8: {
    id: 8,
    codeName: 'URBAN_DISPERSED_CONTAMINATION_RESPONSE',
    title: '08. Ликвидация локального очага дисперсного загрязнения в инфраструктурном узле (Am-241 / Cs-137)',
    category: 'Environmental',
    description:
      'В подземном транспортном вестибюле зафиксирован очаг радиоактивного пылевого загрязнения (америций-241 и цезий-137). Задача расчета РХБЗ: выполнить дозиметрическое зонирование, выставить периметр оцепления и изолировать основной контейнер-источник.',
    playerStartPosition: [0, 1.65, 4.4],
    doseLimitMsv: 1.8,
    maxDurationSec: 175,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.1,
      windDirectionRad: -0.2,
      stabilityClass: 'E',
      ambientTemperatureC: 18,
      humidityPercent: 52,
      isLowLightEmergency: true,
      visibilityRangeMeters: 9.0
    },
    hazards: [
      {
        id: 'sc08_am241_dust_plume',
        nameRu: 'Взвешенный аэрозольный очаг Am-241 в вентиляционном створе',
        type: 'plume',
        position: [-0.35, 0.3, -3.2],
        activityGbk: 3400.0,
        radionuclideKey: 'Am-241',
        geometryData: {
          archetype: 'corroded_waste_drum',
          dimensionsMeters: [0.45, 0.55, 0.45],
          primaryColorHex: 0x475569,
          plumeConfig: {
            plumeLengthMeters: 5.0,
            releaseHeightMeters: 0.4,
            aerosolColorHex: 0x94a3b8,
            baseOpacity: 0.30
          }
        }
      },
      {
        id: 'sc08_cs137_core_fragment',
        nameRu: 'Высокоактивный точечный фрагмент (Cs-137) у колонны зала',
        type: 'point_source',
        position: [0.55, 0.15, -2.8],
        activityGbk: 4200.0,
        radionuclideKey: 'Cs-137',
        geometryData: {
          archetype: 'sealed_isotope_capsule',
          dimensionsMeters: [0.12, 0.20, 0.12],
          primaryColorHex: 0xf97316,
          emissiveColorHex: 0xea580c
        }
      }
    ],
    objectives: [
      {
        id: 'sc08_obj_1_perimeter_triage',
        description: 'Определить границу зоны опасного радиоактивного загрязнения и выставить створ оцепления',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 55,
        doseLimitMsv: 0.6,
        targetEntityId: 'sc08_am241_dust_plume',
        requiredProximityMeters: 3.1
      },
      {
        id: 'sc08_obj_2_vent_cutoff',
        description: 'Локализовать пылевой перенос Am-241 полимерным пылеподавляющим составом',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 115,
        doseLimitMsv: 1.2,
        targetEntityId: 'sc08_am241_dust_plume',
        requiredProximityMeters: 2.0
      },
      {
        id: 'sc08_obj_3_containerize_core',
        description: 'Дистанционным манипулятором эвакуировать фрагмент Cs-137 в свинцовый контейнер КЗ',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 175,
        doseLimitMsv: 1.8,
        targetEntityId: 'sc08_cs137_core_fragment',
        requiredProximityMeters: 1.8
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 09: Радиационная разведка зоны разрушений с наведенной активностью
  // ==========================================================================
  9: {
    id: 9,
    codeName: 'MILITARY_INDUCED_ACTIVITY_RECON',
    title: '09. Специальная разведка РХБЗ в зоне разрушений (Наведенная активность Na-24 / Co-60)',
    category: 'Military',
    description:
      'Разведка укрепленного инженерного сооружения в зоне высоких уровней наведенной гамма-активности в грунте и металлоконструкциях (натрий-24 и кобальт-60). Требуется проложить безопасный коридор эвакуации с учетом экранирования грунтом и бетоном.',
    playerStartPosition: [0, 1.65, 4.5],
    doseLimitMsv: 15.0,
    maxDurationSec: 160,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 3.8,
      windDirectionRad: 0.6,
      stabilityClass: 'C',
      ambientTemperatureC: 28,
      humidityPercent: 35,
      isLowLightEmergency: true,
      visibilityRangeMeters: 8.0
    },
    hazards: [
      {
        id: 'sc09_activated_steel_beam',
        nameRu: 'Оплавленная бронеплита с наведенной активностью (Co-60 / Na-24)',
        type: 'debris',
        position: [-0.5, 0.32, -3.4],
        activityGbk: 38000.0,
        radionuclideKey: 'Na-24',
        materialShieldKey: 'soil',
        shieldThicknessCm: 24.0,
        geometryData: {
          archetype: 'fuel_assembly_fragment',
          dimensionsMeters: [0.85, 0.35, 1.2],
          rotationEulerRad: [0.1, 0.4, 0.0],
          primaryColorHex: 0x475569,
          emissiveColorHex: 0xf59e0b
        }
      },
      {
        id: 'sc09_activated_soil_crater',
        nameRu: 'Очаг активированного шлака и грунта (Sr-90 / Cs-137)',
        type: 'point_source',
        position: [0.8, 0.1, -2.9],
        activityGbk: 22000.0,
        radionuclideKey: 'Cs-137',
        materialShieldKey: 'heavy_concrete',
        shieldThicknessCm: 15.0,
        geometryData: {
          archetype: 'graphite_block',
          dimensionsMeters: [0.65, 0.25, 0.65],
          primaryColorHex: 0x27272a
        }
      }
    ],
    objectives: [
      {
        id: 'sc09_obj_1_recon_gradient',
        description: 'Выполнить замер спада мощности дозы за грунтовым бруствером и железобетонным перекрытием',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 50,
        doseLimitMsv: 4.5,
        targetEntityId: 'sc09_activated_steel_beam',
        requiredProximityMeters: 3.2
      },
      {
        id: 'sc09_obj_2_mark_corridor',
        description: 'Установить защитную плиту на направлении прострела от активированной металлоконструкции',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 110,
        doseLimitMsv: 10.0,
        targetEntityId: 'sc09_activated_steel_beam',
        requiredProximityMeters: 2.2
      },
      {
        id: 'sc09_obj_3_extract_dosimeter_beacon',
        description: 'Разместить автоматический радиометрический маяк у очага активированного грунта',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 160,
        doseLimitMsv: 15.0,
        targetEntityId: 'sc09_activated_soil_crater',
        requiredProximityMeters: 2.0
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 10: Затопление реактора бассейнового типа
  // ==========================================================================
  10: {
    id: 10,
    codeName: 'POOL_REACTOR_WATER_SHIELD_LOSS',
    title: '10. Авария на бассейновом реакторе (Падение уровня воды биозащиты, расчет ослабления H₂O)',
    category: 'NPP',
    description:
      'Утечка деминерализованной воды из бассейна выдержки отработавших ТВС. Слой водной биологической защиты над активной зоной снижается, вызывая экспоненциальный рост МЭД и интенсивное голубое свечение Вавилова — Черенкова.',
    playerStartPosition: [0, 1.65, 4.2],
    doseLimitMsv: 5.0,
    maxDurationSec: 170,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 0.8,
      windDirectionRad: 0.0,
      stabilityClass: 'E',
      ambientTemperatureC: 34,
      humidityPercent: 92,
      isLowLightEmergency: true,
      visibilityRangeMeters: 14.0
    },
    hazards: [
      {
        id: 'sc10_spent_fuel_pool_rack',
        nameRu: 'Стеллаж ОТВС в бассейне выдержки (свечение Вавилова — Черенкова в воде)',
        type: 'point_source',
        position: [0.0, 0.4, -3.5],
        activityGbk: 420000.0,
        radionuclideKey: 'Co-60',
        materialShieldKey: 'water',
        shieldThicknessCm: 145.0, // Водный столб биозащиты (СДО воды ≈ 27 см)
        geometryData: {
          archetype: 'fuel_assembly_fragment',
          dimensionsMeters: [0.9, 0.8, 0.9],
          primaryColorHex: 0x0284c7,
          emissiveColorHex: 0x38bdf8,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 1.35
        }
      },
      {
        id: 'sc10_pool_drain_valve',
        nameRu: 'Дренажный клапан подпитки бассейна выдержки',
        type: 'leak_valve',
        position: [1.1, 1.1, -2.8],
        activityGbk: 1200.0,
        radionuclideKey: 'Cs-137',
        materialShieldKey: 'water',
        shieldThicknessCm: 35.0,
        geometryData: {
          archetype: 'high_pressure_steam_valve',
          dimensionsMeters: [0.45, 0.5, 0.45],
          primaryColorHex: 0x0ea5e9
        }
      }
    ],
    objectives: [
      {
        id: 'sc10_obj_1_measure_water_attenuation',
        description: 'Замерить МЭД над зеркалом воды бассейна выдержки с учетом фактора накопления Бергера в H₂O',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 55,
        doseLimitMsv: 1.5,
        targetEntityId: 'sc10_spent_fuel_pool_rack',
        requiredProximityMeters: 3.0
      },
      {
        id: 'sc10_obj_2_open_makeup_water',
        description: 'Переключить вентиль аварийной подпитки для восстановления защитного слоя воды',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 115,
        doseLimitMsv: 3.5,
        targetEntityId: 'sc10_pool_drain_valve',
        requiredProximityMeters: 1.8
      },
      {
        id: 'sc10_obj_3_install_top_shield',
        description: 'Надвинуть стальную защитную крышку перекрытия над шахтой бассейна',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 170,
        doseLimitMsv: 5.0,
        targetEntityId: 'sc10_spent_fuel_pool_rack',
        requiredProximityMeters: 2.4
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 11: Разгерметизация подводных / затопленных хранилищ
  // ==========================================================================
  11: {
    id: 11,
    codeName: 'SUBMERGED_WASTE_CONTAINERS_CORROSION',
    title: '11. Разгерметизация затопленных контейнеров РАО (Сквозная коррозия бочек, Sr-90 / Cs-137)',
    category: 'Environmental',
    description:
      'В гидротехническом кессоне берегового хранилища произошла сквозная коррозия стальных оболочек контейнеров с радиоактивными отходами (стронций-90 и цезий-137). Происходит вымывание радионуклидов в придонную воду.',
    playerStartPosition: [0, 1.65, 4.3],
    doseLimitMsv: 1.2,
    maxDurationSec: 180,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 0.9,
      windDirectionRad: 0.1,
      stabilityClass: 'E',
      ambientTemperatureC: 9,
      humidityPercent: 95,
      isLowLightEmergency: true,
      visibilityRangeMeters: 7.5
    },
    hazards: [
      {
        id: 'sc11_corroded_sr90_drum',
        nameRu: 'Корродированный контейнер РАО с выходом бета/гамма нуклидов (Sr-90 / Cs-137)',
        type: 'point_source',
        position: [-0.45, 0.38, -3.2],
        activityGbk: 6800.0,
        radionuclideKey: 'Sr-90',
        materialShieldKey: 'water',
        shieldThicknessCm: 22.0,
        geometryData: {
          archetype: 'corroded_waste_drum',
          dimensionsMeters: [0.65, 0.95, 0.65],
          primaryColorHex: 0x7c2d12,
          emissiveColorHex: 0x38bdf8,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 0.52
        }
      },
      {
        id: 'sc11_leaching_water_puddle',
        nameRu: 'Зона выщелачивания радиоактивного рассола Cs-137 на днище кессона',
        type: 'point_source',
        position: [0.5, 0.04, -2.9],
        activityGbk: 2400.0,
        radionuclideKey: 'Cs-137',
        geometryData: {
          archetype: 'radiochem_puddle',
          dimensionsMeters: [1.7, 0.03, 1.7],
          primaryColorHex: 0x0284c7,
          emissiveColorHex: 0x0369a1
        }
      }
    ],
    objectives: [
      {
        id: 'sc11_obj_1_inspect_drums',
        description: 'Обследовать корродированные контейнеры в кессоне с помощью тактического фонаря',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 55,
        doseLimitMsv: 0.4,
        targetEntityId: 'sc11_corroded_sr90_drum',
        requiredProximityMeters: 2.8
      },
      {
        id: 'sc11_obj_2_apply_overpack',
        description: 'Установить защитный стальной оверпак поверх разгерметизированной бочки Sr-90',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 120,
        doseLimitMsv: 0.85,
        targetEntityId: 'sc11_corroded_sr90_drum',
        requiredProximityMeters: 1.9
      },
      {
        id: 'sc11_obj_3_sorbent_barrier',
        description: 'Разместить цеолитовый сорбционный барьер вокруг зоны выщелачивания Cs-137',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 180,
        doseLimitMsv: 1.2,
        targetEntityId: 'sc11_leaching_water_puddle',
        requiredProximityMeters: 2.0
      }
    ]
  },

  // ==========================================================================
  // СЦЕНАРИЙ 12: Авария в цехе регенерации топлива (Разлив Pu-239, угроза СЦР)
  // ==========================================================================
  12: {
    id: 12,
    codeName: 'REPROCESSING_PLANT_PLUTONIUM_CRITICALITY',
    title: '12. Авария в радиохимическом цехе регенерации ОЯТ (Разлив растворов Pu-239, угроза СЦР)',
    category: 'NPP',
    description:
      'Разгерметизация аппарата-экстрактора в горячей камере радиохимического завода. На поддоне образовался разлив азотнокислого раствора плутония-239 с риском достижения критической геометрии (СЦР, вспышки Вавилова — Черенкова и нейтронный поток).',
    playerStartPosition: [0, 1.65, 4.4],
    doseLimitMsv: 3.0,
    maxDurationSec: 165,
    requireHazmatPpe: true,
    atmosphere: {
      windSpeedMps: 1.2,
      windDirectionRad: -0.15,
      stabilityClass: 'D',
      ambientTemperatureC: 31,
      humidityPercent: 68,
      isLowLightEmergency: true,
      visibilityRangeMeters: 6.0
    },
    hazards: [
      {
        id: 'sc12_pu239_criticality_vessel',
        nameRu: 'Аварийный аппарат-экстрактор с предкритическим раствором (Pu-239 / Cf-252)',
        type: 'point_source',
        position: [0.0, 1.25, -3.4],
        activityGbk: 14500.0,
        radionuclideKey: 'Cf-252',
        materialShieldKey: 'heavy_concrete',
        shieldThicknessCm: 10.0,
        geometryData: {
          archetype: 'tuk_transport_cask',
          dimensionsMeters: [0.75, 1.85, 0.75],
          primaryColorHex: 0x334155,
          emissiveColorHex: 0x38bdf8,
          hasCherenkovGlow: true,
          cherenkovRadiusMeters: 0.95
        }
      },
      {
        id: 'sc12_plutonium_nitrate_puddle',
        nameRu: 'Радиоактивно-химическая лужа нитрата плутония-239 с SSS-свечением',
        type: 'point_source',
        position: [0.2, 0.02, -3.0],
        activityGbk: 9200.0,
        radionuclideKey: 'Pu-239',
        geometryData: {
          archetype: 'radiochem_puddle',
          dimensionsMeters: [1.65, 0.025, 1.65],
          primaryColorHex: 0x10b981,
          emissiveColorHex: 0x059669
        }
      },
      {
        id: 'sc12_nitric_acid_aerosol_valve',
        nameRu: 'Запорный вентиль коллектора экстракции с нитрозным аэрозолем',
        type: 'leak_valve',
        position: [0.75, 1.4, -3.1],
        activityGbk: 3100.0,
        radionuclideKey: 'Pu-239',
        geometryData: {
          archetype: 'high_pressure_steam_valve',
          dimensionsMeters: [0.42, 0.48, 0.42],
          primaryColorHex: 0x475569,
          plumeConfig: {
            plumeLengthMeters: 4.8,
            releaseHeightMeters: 1.1,
            aerosolColorHex: 0x94a3b8,
            baseOpacity: 0.34
          }
        }
      }
    ],
    objectives: [
      {
        id: 'sc12_obj_1_neutron_absorber',
        description: 'Ввести кадмиево-борный поглотитель нейтронов к аппарату-экстрактору для предотвращения СЦР',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 50,
        doseLimitMsv: 1.0,
        targetEntityId: 'sc12_pu239_criticality_vessel',
        requiredProximityMeters: 2.6
      },
      {
        id: 'sc12_obj_2_close_feed_valve',
        description: 'Перекрыть вентиль подачи плутониевого раствора в коллекторе экстракции',
        status: 'pending',
        criticality: 'critical',
        timeThresholdSec: 110,
        doseLimitMsv: 2.0,
        targetEntityId: 'sc12_nitric_acid_aerosol_valve',
        requiredProximityMeters: 1.8
      },
      {
        id: 'sc12_obj_3_evacuate_sample',
        description: 'Дистанционным манипулятором изолировать пробу из зоны разлива нитрата плутония',
        status: 'pending',
        criticality: 'high',
        timeThresholdSec: 165,
        doseLimitMsv: 3.0,
        targetEntityId: 'sc12_plutonium_nitrate_puddle',
        requiredProximityMeters: 2.1
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
