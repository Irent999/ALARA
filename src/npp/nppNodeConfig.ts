/**
 * ALARA — Единый централизованный конфиг Сценария №4 (/assembly.glb)
 * Содержит в одном месте:
 * - масштаб, поворот и смещение сборки АЭС (ASSEMBLY_SCALE, ASSEMBLY_TARGET_FOOTPRINT_M, ASSEMBLY_ROTATION_DEG, ASSEMBLY_YAW_DEG, ASSEMBLY_OFFSET)
 * - рост/масштаб игрока и скорость передвижения (PLAYER_EYE_HEIGHT, PLAYER_SCALE)
 * - масштаб NPC и очагов возгорания (NPC_SCALE, FIRE_SCALE, MARKER_SCALE)
 * - параметры внутренних зон очагов пожара и 4 групп персонала (10 человек внутри зданий)
 *
 * Масштаб сцены: 1 единица Three.js = 1 метр (1:1 м).
 */

export interface WallColliderBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minY: number;
  readonly maxY: number;
}

export type Scenario4OrientationMode = 'auto_z_up' | 'always' | 'none';

export interface FireZoneSpec {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
  /** Индекс обнаруженного корпуса АЭС в графе сцены (0 = Западный/Главный блок, 1 = Восточный блок, 2 = Центральный корпус) */
  readonly preferredBuildingIndex: number;
  /** Локальное смещение [dx, dz] в долях [-0.30..+0.30] внутри Box3 обнаруженного здания */
  readonly buildingOffsetXZ: readonly [number, number];
  /** Резервные нормализованные координаты [-0.5..+0.5] относительно всего Box3 площадки */
  readonly relPos: readonly [number, number, number];
  /** Резервные мировые координаты в метрах */
  readonly defaultPos: readonly [number, number, number];
  readonly initialIntensity: number; // 0..1
  readonly smokeDensity: number; // 0..1
  readonly heatRadiusM: number;
  readonly radiusM: number;
}

export interface NpcGroupSpec {
  readonly id: string;
  readonly markerName: string;
  readonly waypointPrefix: string;
  readonly nameRu: string;
  readonly count: number;
  /** Индекс корпуса, внутри которого находится группа NPC */
  readonly preferredBuildingIndex: number;
  /** Локальное смещение [dx, dz] внутри Box3 обнаруженного здания (вдали от стен и пламени) */
  readonly buildingOffsetXZ: readonly [number, number];
  /** Начальное состояние группы до контакта со спасателем */
  readonly initialState: 'IDLE' | 'PANIC' | 'WAITING_FOR_GUIDE';
  readonly suitColorHex: number;
  readonly helmetColorHex: number;
  /** Резервные нормализованные координаты [-0.5..+0.5] относительно всего Box3 площадки */
  readonly relPos: readonly [number, number, number];
  readonly relWaypoints: ReadonlyArray<readonly [number, number, number]>;
  readonly relExitPoint: readonly [number, number, number];
  readonly defaultPos: readonly [number, number, number];
  readonly evacWaypoints: ReadonlyArray<readonly [number, number, number]>;
  readonly exitPoint: readonly [number, number, number];
  readonly blockedByFireId: string;
  readonly detectionRadiusM: number;
  readonly firePanicRadiusM: number;
}

export interface TriggerZoneSpec {
  readonly id: string;
  readonly markerName: string;
  readonly kind: 'entry' | 'hazard' | 'evac' | 'assembly';
  readonly nameRu: string;
  readonly relPos: readonly [number, number, number];
  readonly defaultPos: readonly [number, number, number];
  readonly radiusM: number;
}

export interface NppNodePrefixesConfig {
  readonly playerSpawn: ReadonlyArray<string>;
  readonly entrances: ReadonlyArray<string>;
  readonly exits: ReadonlyArray<string>;
  readonly assemblyPoints: ReadonlyArray<string>;
  readonly evacPoints: ReadonlyArray<string>;
  readonly fireZones: ReadonlyArray<string>;
  readonly npcSpawns: ReadonlyArray<string>;
  readonly waypoints: ReadonlyArray<string>;
  readonly triggers: ReadonlyArray<string>;
  readonly pois: ReadonlyArray<string>;
  readonly extinguishers: ReadonlyArray<string>;
  readonly colliderKeywords: ReadonlyArray<string>;
}

/**
 * Главная панель настройки Сценария №4 (меняйте коэффициенты здесь для быстрой подгонки на глаз).
 */
export const SCENARIO_4_CONFIG = {
  // --- 1. Трансформация и масштаб 3D-сборки /assembly.glb ---
  /** Целевой горизонтальный габарит комплекса АЭС в метрах (реальный архитектурный масштаб: корпуса 25–35 м в высоту) */
  ASSEMBLY_TARGET_FOOTPRINT_M: 165,
  /** Ручной множитель поверх ASSEMBLY_TARGET_FOOTPRINT_M (удобно быстро масштабировать всю сборку) */
  ASSEMBLY_SCALE: 1.0,
  /** Поворот [rx, ry, rz] в градусах (+90° по X ставит CAD-модель основанием вниз на y = 0) */
  ASSEMBLY_ROTATION_DEG: [90, 0, 0] as readonly [number, number, number],
  /** Дополнительный поворот вокруг вертикальной оси Y (180° разворачивает энергоблоки фасадом к точке старта) */
  ASSEMBLY_YAW_DEG: 180,
  /** Режим автоповорота Z-up -> Y-up */
  ASSEMBLY_ORIENTATION_MODE: 'auto_z_up' as Scenario4OrientationMode,
  /** Смещение всей сборки АЭС [dx, dy, dz] в метрах */
  ASSEMBLY_OFFSET: [0, 0, 0] as readonly [number, number, number],

  // --- 2. Масштаб и высота игрока / XR-рига / NPC / эффектов ---
  /** Рост глаз игрока над уровнем пола в метрах (нормальный рост человека ~1.70–1.75 м) */
  PLAYER_EYE_HEIGHT: 1.7,
  /** Масштаб 3D-аватара игрока (1.0 = натуральный человеческий рост) */
  PLAYER_SCALE: 1.0,
  /** Скорость перемещения в Desktop-режиме (м/с, Shift ускоряет в 1.65 раза) */
  PLAYER_MOVE_SPEED_DESKTOP: 5.2,
  /** Скорость перемещения в VR-режиме HTC Vive (м/с) */
  PLAYER_MOVE_SPEED_VR: 2.8,
  /** Масштаб NPC (1.0 = ~1.72 м рост взрослого человека) */
  NPC_SCALE: 1.0,
  /** Масштаб очагов пожара и дыма */
  FIRE_SCALE: 0.95,
  /** Масштаб табличек ВХОД / ВЫХОД / ПУНКТ СБОРА */
  MARKER_SCALE: 0.85,

  // --- 3. Параметры стартовой позиции игрока и обзорной камеры [K] ---
  SPAWN: {
    forwardMarginMeters: 4.5,
    lateralNormX: 0.0,
    lookAtHeightRatio: 0.22,
    overviewDistanceFactor: 0.82,
    overviewElevationFactor: 0.44
  },

  // --- 4. Внутренние очаги возгорания (внутри зданий АЭС) ---
  FIRE_ZONES: [
    {
      id: 'fire_1',
      markerName: 'FIRE_ZONE_1',
      nameRu: 'Очаг №1: Кабельный отсек внутри корпуса №1 (Запад)',
      preferredBuildingIndex: 0,
      buildingOffsetXZ: [-0.14, 0.06],
      relPos: [-0.18, 0, 0.14],
      defaultPos: [-29.7, 0, 23.1],
      initialIntensity: 1.0,
      smokeDensity: 0.7,
      heatRadiusM: 3.6,
      radiusM: 1.15
    },
    {
      id: 'fire_2',
      markerName: 'FIRE_ZONE_2',
      nameRu: 'Очаг №2: Маслосистема внутри машзала №2 (Восток)',
      preferredBuildingIndex: 1,
      buildingOffsetXZ: [0.12, -0.05],
      relPos: [0.18, 0, 0.12],
      defaultPos: [29.7, 0, 19.8],
      initialIntensity: 1.0,
      smokeDensity: 0.78,
      heatRadiusM: 3.8,
      radiusM: 1.2
    },
    {
      id: 'fire_3',
      markerName: 'FIRE_ZONE_3',
      nameRu: 'Очаг №3: Щит управления внутри центрального корпуса',
      preferredBuildingIndex: 2,
      buildingOffsetXZ: [0.0, 0.08],
      relPos: [-0.26, 0, -0.02],
      defaultPos: [-42.9, 0, -3.3],
      initialIntensity: 0.88,
      smokeDensity: 0.64,
      heatRadiusM: 3.3,
      radiusM: 1.05
    }
  ] as ReadonlyArray<FireZoneSpec>,

  // --- 5. Группы персонала внутри зданий (всего 10 человек: 3 + 3 + 2 + 2) ---
  NPC_GROUPS: [
    {
      id: 'npc_group_1',
      markerName: 'NPC_GROUP_1',
      waypointPrefix: 'WAYPOINT_G1_',
      nameRu: 'Оперативная смена БЩУ (Корпус №1, 3 чел.)',
      count: 3,
      preferredBuildingIndex: 0,
      buildingOffsetXZ: [0.16, -0.14],
      initialState: 'PANIC',
      suitColorHex: 0x2563eb,
      helmetColorHex: 0xf8fafc,
      relPos: [-0.14, 0, 0.05],
      relWaypoints: [
        [-0.12, 0, 0.22],
        [-0.04, 0, 0.36],
        [0.02, 0, 0.44]
      ],
      relExitPoint: [0.0, 0, 0.46],
      defaultPos: [-23.1, 0, 8.2],
      evacWaypoints: [
        [-19.8, 0, 36.3],
        [-6.6, 0, 59.4],
        [3.3, 0, 72.6]
      ],
      exitPoint: [0, 0, 75.9],
      blockedByFireId: 'fire_1',
      detectionRadiusM: 7.0,
      firePanicRadiusM: 28.0
    },
    {
      id: 'npc_group_2',
      markerName: 'NPC_GROUP_2',
      waypointPrefix: 'WAYPOINT_G2_',
      nameRu: 'Персонал машзала (Корпус №2, 3 чел.)',
      count: 3,
      preferredBuildingIndex: 1,
      buildingOffsetXZ: [-0.14, -0.16],
      initialState: 'PANIC',
      suitColorHex: 0x0d9488,
      helmetColorHex: 0xf59e0b,
      relPos: [0.22, 0, 0.02],
      relWaypoints: [
        [0.16, 0, 0.2],
        [0.08, 0, 0.35],
        [0.02, 0, 0.44]
      ],
      relExitPoint: [0.0, 0, 0.46],
      defaultPos: [36.3, 0, 3.3],
      evacWaypoints: [
        [26.4, 0, 33.0],
        [13.2, 0, 57.7],
        [3.3, 0, 72.6]
      ],
      exitPoint: [0, 0, 75.9],
      blockedByFireId: 'fire_2',
      detectionRadiusM: 7.0,
      firePanicRadiusM: 28.0
    },
    {
      id: 'npc_group_3',
      markerName: 'NPC_GROUP_3',
      waypointPrefix: 'WAYPOINT_G3_',
      nameRu: 'Инженеры КИПиА (Вспомогательный корпус, 2 чел.)',
      count: 2,
      preferredBuildingIndex: 2,
      buildingOffsetXZ: [-0.14, -0.14],
      initialState: 'PANIC',
      suitColorHex: 0xd97706,
      helmetColorHex: 0xfef08a,
      relPos: [-0.30, 0, -0.10],
      relWaypoints: [
        [-0.22, 0, 0.14],
        [-0.08, 0, 0.34],
        [0.02, 0, 0.44]
      ],
      relExitPoint: [0.0, 0, 0.46],
      defaultPos: [-49.5, 0, -16.5],
      evacWaypoints: [
        [-36.3, 0, 23.1],
        [-13.2, 0, 56.1],
        [3.3, 0, 72.6]
      ],
      exitPoint: [0, 0, 75.9],
      blockedByFireId: 'fire_3',
      detectionRadiusM: 7.0,
      firePanicRadiusM: 28.0
    },
    {
      id: 'npc_group_4',
      markerName: 'NPC_GROUP_4',
      waypointPrefix: 'WAYPOINT_G4_',
      nameRu: 'Дежурные электрики КРУ (Секция А, 2 чел.)',
      count: 2,
      preferredBuildingIndex: 0,
      buildingOffsetXZ: [0.18, 0.18],
      initialState: 'WAITING_FOR_GUIDE',
      suitColorHex: 0x4f46e5,
      helmetColorHex: 0x38bdf8,
      relPos: [-0.08, 0, 0.22],
      relWaypoints: [
        [-0.04, 0, 0.34],
        [0.0, 0, 0.43]
      ],
      relExitPoint: [0.0, 0, 0.46],
      defaultPos: [-13.2, 0, 36.3],
      evacWaypoints: [
        [-6.6, 0, 56.1],
        [0, 0, 70.9]
      ],
      exitPoint: [0, 0, 75.9],
      blockedByFireId: '',
      detectionRadiusM: 7.5,
      firePanicRadiusM: 12.0
    }
  ] as ReadonlyArray<NpcGroupSpec>,

  // --- 6. Проверка зазоров внутри зданий (без застревания очагов и оборудования в стенах) ---
  FIRE_CLEARANCE: {
    minWallClearanceM: 2.0,
    minHeadroomM: 2.6,
    fireElevationOffsetM: 0.04,
    searchRadiusStepM: 1.6,
    maxSearchRings: 5
  },

  // --- 7. Внутреннее техническое оборудование АЭС в корпусах ---
  EQUIPMENT_LAYOUT: {
    enabled: true,
    minClearanceFromFireOrNpcM: 3.4,
    maxBuildingsToPopulate: 4,
    equipmentScale: 1.0
  },

  // --- 8. Пожарно-спасательный автомобиль МЧС (АЦ-40) и движение между корпусами ---
  VEHICLE: {
    spawnOffsetFromPlayer: [6.2, 0, -2.5] as readonly [number, number, number],
    maxSpeedMps: 11.5,
    reverseSpeedMps: 5.0,
    accelerationMps2: 7.5,
    dragPerSec: 3.8,
    turnRateRadPerSec: 1.55,
    boardRadiusM: 4.5,
    autopilotArrivalDistM: 3.2,
    autopilotSpeedMps: 8.8,
    // Леворульная посадка (+X в системе машины, смотрящей вперёд по +Z)
    seatLocalOffset: [0.50, 1.78, 1.54] as readonly [number, number, number],
    exitSideOffset: [2.35, 0, 1.54] as readonly [number, number, number],
    pumpLocalOffset: [0, 0.95, -2.85] as readonly [number, number, number],
    collisionRadiusM: 2.1,
    /**
     * Настройки границ передвижения АЦ-40 по территории /assembly.glb:
     * - freeRoamAcrossSite: отключает блокировку грубыми прямоугольниками (Box3) зданий и стен,
     *   чтобы машина свободно ездила по дорогам, дворам и всей площадке без «невидимых стен».
     * - clampToSiteBox3: ограничивает выезд за пределы реального Box3 сборки (с учётом scale/rotation).
     * - edgeMarginM: отступ внутрь от краёв Box3 площадки в метрах (положительный — внутрь, отрицательный — выезд за край).
     */
    driveBounds: {
      freeRoamAcrossSite: true,
      clampToSiteBox3: true,
      edgeMarginM: 2.0,
      enableBuildingBoxColliders: false,
      enableExtraColliders: false,
      maxColliderSiteFraction: 0.42,
      maxDeckStepHeightM: 2.2,
      groundFollowSmoothRate: 10.0
    }
  },

  // --- 9. Пожарный рукав (Hose) от машины МЧС к внутренним очагам ---
  HOSE: {
    maxLengthM: 58,
    warningLengthRatio: 0.85,
    sprayRangeM: 9.8,
    suppressionRateMultiplier: 1.55,
    pickupRadiusM: 4.2,
    segmentCount: 36,
    hoseRadiusM: 0.042,
    anchorStepM: 3.4
  },

  // --- 10. Дополнительные аварийные операции МЧС (разведка, перекрытие контура, медпомощь) ---
  EMERGENCY_OPS: {
    radReconRadiusM: 4.6,
    radReconDurationSec: 1.4,
    loopIsolationRadiusM: 3.5,
    smokeReductionFactor: 0.35,
    casualtyTriageRadiusM: 3.5
  }
} as const;

export interface Scenario4TransformConfig {
  readonly rotationDeg: readonly [number, number, number];
  readonly yawDeg: number;
  readonly orientationMode: Scenario4OrientationMode;
  readonly targetFootprintMeters: number;
  readonly scaleMultiplier: number;
  readonly centerXZ: boolean;
  readonly alignBottomToZeroY: boolean;
  readonly positionOffset: readonly [number, number, number];
  readonly effectScale: number;
  readonly markerScale: number;
  readonly npcScale: number;
  readonly playerScale: number;
  readonly spawn: {
    readonly forwardMarginMeters: number;
    readonly lateralNormX: number;
    readonly eyeHeightMeters: number;
    readonly lookAtHeightRatio: number;
    readonly overviewDistanceFactor: number;
    readonly overviewElevationFactor: number;
  };
}

export const SCENARIO_4_TRANSFORM: Scenario4TransformConfig = {
  rotationDeg: SCENARIO_4_CONFIG.ASSEMBLY_ROTATION_DEG,
  yawDeg: SCENARIO_4_CONFIG.ASSEMBLY_YAW_DEG,
  orientationMode: SCENARIO_4_CONFIG.ASSEMBLY_ORIENTATION_MODE,
  targetFootprintMeters: SCENARIO_4_CONFIG.ASSEMBLY_TARGET_FOOTPRINT_M,
  scaleMultiplier: SCENARIO_4_CONFIG.ASSEMBLY_SCALE,
  centerXZ: true,
  alignBottomToZeroY: true,
  positionOffset: SCENARIO_4_CONFIG.ASSEMBLY_OFFSET,
  effectScale: SCENARIO_4_CONFIG.FIRE_SCALE,
  markerScale: SCENARIO_4_CONFIG.MARKER_SCALE,
  npcScale: SCENARIO_4_CONFIG.NPC_SCALE,
  playerScale: SCENARIO_4_CONFIG.PLAYER_SCALE,
  spawn: {
    forwardMarginMeters: SCENARIO_4_CONFIG.SPAWN.forwardMarginMeters,
    lateralNormX: SCENARIO_4_CONFIG.SPAWN.lateralNormX,
    eyeHeightMeters: SCENARIO_4_CONFIG.PLAYER_EYE_HEIGHT,
    lookAtHeightRatio: SCENARIO_4_CONFIG.SPAWN.lookAtHeightRatio,
    overviewDistanceFactor: SCENARIO_4_CONFIG.SPAWN.overviewDistanceFactor,
    overviewElevationFactor: SCENARIO_4_CONFIG.SPAWN.overviewElevationFactor
  }
};

export interface NppAssemblyConfig {
  readonly glbUrl: string;
  readonly dracoDecoderPath: string;
  readonly transform: Scenario4TransformConfig;
  readonly prefixes: NppNodePrefixesConfig;
  readonly defaultEntranceRelPos: readonly [number, number, number];
  readonly defaultAssemblyRelPos: readonly [number, number, number];
  readonly defaultPrimaryExtinguisherRelOffset: readonly [number, number, number];
  readonly defaultSpareExtinguisherRelPos: readonly [number, number, number];
  readonly defaultSpawnPos: readonly [number, number, number];
  readonly defaultEntrancePos: readonly [number, number, number];
  readonly defaultAssemblyPos: readonly [number, number, number];
  readonly defaultPrimaryExtinguisherPos: readonly [number, number, number];
  readonly defaultSpareExtinguisherPos: readonly [number, number, number];
  readonly defaultExits: ReadonlyArray<{
    readonly id: string;
    readonly nameRu: string;
    readonly relPos: readonly [number, number, number];
    readonly pos: readonly [number, number, number];
  }>;
  readonly fireZones: ReadonlyArray<FireZoneSpec>;
  readonly npcGroups: ReadonlyArray<NpcGroupSpec>;
  readonly triggerZones: ReadonlyArray<TriggerZoneSpec>;
  readonly wallColliders: ReadonlyArray<WallColliderBox>;
}

const rawBaseUrl = import.meta.env?.BASE_URL ?? '/';
const BASE_URL = rawBaseUrl.endsWith('/') ? rawBaseUrl : `${rawBaseUrl}/`;

export const NPP_NODE_CONFIG: NppAssemblyConfig = {
  glbUrl: `${BASE_URL}assembly.glb`,
  dracoDecoderPath: `${BASE_URL}draco/gltf/`,
  transform: SCENARIO_4_TRANSFORM,

  prefixes: {
    playerSpawn: ['SPAWN_PLAYER', 'PLAYER_SPAWN'],
    entrances: ['ENTRANCE_', 'ENTRY_'],
    exits: ['EXIT_', 'EVAC_EXIT_'],
    assemblyPoints: ['ASSEMBLY_', 'SAFE_ZONE_'],
    evacPoints: ['EVAC_POINT_', 'EVAC_ZONE_'],
    fireZones: ['FIRE_ZONE_', 'FIRE_'],
    npcSpawns: ['NPC_GROUP_', 'NPC_SPAWN_'],
    waypoints: ['WAYPOINT_', 'PATH_', 'EVAC_WP_'],
    triggers: ['TRIGGER_', 'ZONE_TRIGGER_'],
    pois: ['POI_', 'MARKER_'],
    extinguishers: ['EXTINGUISHER_POINT_', 'EXTINGUISHER_', 'OU5_'],
    colliderKeywords: ['WALL', 'COLLIDER', 'BARRIER']
  },

  defaultEntranceRelPos: [0.0, 0, 0.34],
  defaultAssemblyRelPos: [0.14, 0, 0.46],
  defaultPrimaryExtinguisherRelOffset: [-2.4, 0, -3.2],
  defaultSpareExtinguisherRelPos: [0.04, 0, 0.22],

  defaultSpawnPos: [0, 0, 87.0],
  defaultEntrancePos: [0, 0, 56.1],
  defaultAssemblyPos: [23.1, 0, 75.9],
  defaultPrimaryExtinguisherPos: [-2.4, 0, 83.8],
  defaultSpareExtinguisherPos: [6.6, 0, 36.3],

  defaultExits: [
    {
      id: 'EXIT_MAIN',
      nameRu: 'Главный выход из корпуса (Юг)',
      relPos: [0.0, 0, 0.43],
      pos: [0, 0, 71.0]
    },
    {
      id: 'EXIT_EAST',
      nameRu: 'Восточный эваковыход',
      relPos: [0.36, 0, 0.24],
      pos: [59.4, 0, 39.6]
    }
  ],

  fireZones: SCENARIO_4_CONFIG.FIRE_ZONES,
  npcGroups: SCENARIO_4_CONFIG.NPC_GROUPS,

  triggerZones: [
    {
      id: 'TRIGGER_ENTRY_REACTOR',
      markerName: 'TRIGGER_ENTRY',
      kind: 'entry',
      nameRu: 'Входной шлюз в корпус энергоблоков',
      relPos: [0.0, 0, 0.34],
      defaultPos: [0, 0, 56.1],
      radiusM: 4.5
    },
    {
      id: 'TRIGGER_EVAC_CORRIDOR',
      markerName: 'TRIGGER_EVAC',
      kind: 'evac',
      nameRu: 'Восточный коридор эвакуации',
      relPos: [0.36, 0, 0.24],
      defaultPos: [59.4, 0, 39.6],
      radiusM: 4.5
    },
    {
      id: 'TRIGGER_ASSEMBLY_SAFE',
      markerName: 'TRIGGER_ASSEMBLY',
      kind: 'assembly',
      nameRu: 'Безопасный пункт сбора МЧС',
      relPos: [0.14, 0, 0.46],
      defaultPos: [23.1, 0, 75.9],
      radiusM: 5.5
    }
  ],

  wallColliders: []
};

/**
 * Конфигурация габаритов кабины, лобового стекла, рулевого колеса,
 * приборной панели водителя, пульта управления пожарным насосом
 * и точки посадки камеры/VR-рига автомобиля АЦ-40 МЧС Узбекистана.
 * Локальные координаты относительно vehicleGroup (вперёд +Z, вверх +Y, влево +X).
 */
export interface Ac40CabConfig {
  readonly cabWidthM: number;
  readonly cabFrontZ: number;
  readonly cabRearZ: number;
  readonly cabFloorY: number;
  readonly cabRoofY: number;
  readonly cowlTopY: number;
  readonly doorHaloLocalOffset: readonly [number, number, number];
  readonly desktopInitialPitchRad: number;
  readonly vrMinEyeY: number;
  readonly vrMaxEyeY: number;
  readonly windshield: {
    readonly widthM: number;
    readonly heightM: number;
    readonly centerY: number;
    readonly centerZ: number;
    readonly tiltXRad: number;
    readonly opacity: number;
    readonly tintHex: number;
  };
  readonly dashboard: {
    readonly centerX: number;
    readonly baseY: number;
    readonly centerZ: number;
    readonly widthM: number;
    readonly depthM: number;
    readonly clusterOffsetX: number;
    readonly clusterOffsetY: number;
    readonly clusterOffsetZ: number;
    readonly clusterTiltXRad: number;
    readonly screenWidthM: number;
    readonly screenHeightM: number;
  };
  readonly steeringWheel: {
    readonly pivotPos: readonly [number, number, number];
    readonly tiltXRad: number;
    readonly radiusM: number;
    readonly tubeRadiusM: number;
    readonly maxVisualTurnRad: number;
  };
  readonly pumpConsole: {
    readonly pos: readonly [number, number, number];
    readonly yawRad: number;
    readonly tiltXRad: number;
    readonly widthM: number;
    readonly heightM: number;
    readonly screenWidthM: number;
    readonly screenHeightM: number;
  };
  readonly canvasRefreshMinIntervalMs: number;
}

export const AC40_CAB_CONFIG: Ac40CabConfig = {
  cabWidthM: 2.28,
  cabFrontZ: 2.96,
  cabRearZ: 0.96,
  cabFloorY: 0.88,
  cabRoofY: 2.26,
  cowlTopY: 1.46,
  doorHaloLocalOffset: [1.94, 0.03, 1.85],
  desktopInitialPitchRad: -0.1,
  vrMinEyeY: 0.95,
  vrMaxEyeY: 1.95,
  windshield: {
    widthM: 2.02,
    heightM: 0.76,
    centerY: 1.83,
    centerZ: 2.79,
    tiltXRad: -0.22,
    opacity: 0.14,
    tintHex: 0xdbeafe
  },
  dashboard: {
    centerX: 0,
    baseY: 1.24,
    centerZ: 2.48,
    widthM: 2.08,
    depthM: 0.44,
    clusterOffsetX: 0.50,
    clusterOffsetY: 1.44,
    clusterOffsetZ: 2.38,
    clusterTiltXRad: -0.28,
    screenWidthM: 0.50,
    screenHeightM: 0.21
  },
  steeringWheel: {
    pivotPos: [0.50, 1.41, 2.07],
    tiltXRad: 0.46,
    radiusM: 0.215,
    tubeRadiusM: 0.021,
    maxVisualTurnRad: 2.45
  },
  pumpConsole: {
    pos: [-0.04, 1.37, 2.24],
    yawRad: 0.28,
    tiltXRad: -0.48,
    widthM: 0.46,
    heightM: 0.34,
    screenWidthM: 0.36,
    screenHeightM: 0.19
  },
  canvasRefreshMinIntervalMs: 80
};

