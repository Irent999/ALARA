/**
 * ALARA — Единая конфигурация трансформации, узлов/префиксов 3D-модели комплекса АЭС (/assembly.glb)
 * и относительных координат Сценария №4.
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

/**
 * Единый конфиг трансформации модели /assembly.glb, масштаба эффектов/маркеров и спавна камеры в Сценарии №4.
 * Измените параметры здесь, чтобы мгновенно подстроить масштаб, ориентацию или точку старта без правок логики.
 */
export interface Scenario4TransformConfig {
  /** Поворот модели [rx, ry, rz] в градусах ([-90, 0, 0] переводит CAD/Blender Z-up в Three.js Y-up) */
  readonly rotationDeg: readonly [number, number, number];
  /** Режим применения rotationDeg: 'auto_z_up' (если модель плоская по X/Y и вытянута вверх по Z), 'always' или 'none' */
  readonly orientationMode: Scenario4OrientationMode;
  /** Целевой горизонтальный размер (max по X/Z) комплекса АЭС в метрах после нормализации */
  readonly targetFootprintMeters: number;
  /** Дополнительный ручной множитель масштаба поверх targetFootprintMeters */
  readonly scaleMultiplier: number;
  /** Центрировать модель по горизонтали в (0, 0) */
  readonly centerXZ: boolean;
  /** Ставить нижнюю границу Box3 (min.y) ровно на Y = 0 */
  readonly alignBottomToZeroY: boolean;
  /** Дополнительное смещение всей модели [dx, dy, dz] в метрах */
  readonly positionOffset: readonly [number, number, number];
  /** Масштаб визуальных эффектов огня, дыма и площадок очагов (1.0 = стандарт, < 1.0 = компактнее) */
  readonly effectScale: number;
  /** Масштаб табличек ВХОД / ВЫХОД / ПУНКТ СБОРА и направляющих маркеров */
  readonly markerScale: number;
  /** Параметры стартовой позиции камеры/игрока и обзорного фокуса [K] */
  readonly spawn: {
    /** Отступ в метрах перед южной (передней) границей Box3 модели */
    readonly forwardMarginMeters: number;
    /** Боковое смещение по ширине модели (-0.5..+0.5) */
    readonly lateralNormX: number;
    /** Высота глаз оператора над уровнем площадки модели (м) */
    readonly eyeHeightMeters: number;
    /** Относительная высота точки взгляда (0..1 от высоты Box3) */
    readonly lookAtHeightRatio: number;
    /** Коэффициент дистанции обзорной камеры [K] от диагонали модели */
    readonly overviewDistanceFactor: number;
    /** Коэффициент высоты обзорной камеры [K] от диагонали модели */
    readonly overviewElevationFactor: number;
  };
}

export const SCENARIO_4_TRANSFORM: Scenario4TransformConfig = {
  // Положительный поворот +90° по оси X ставит CAD-модель /assembly.glb основанием вниз (плита на y=0, градирни и блоки вверх)
  rotationDeg: [90, 0, 0],
  orientationMode: 'auto_z_up',
  // Габарит промышленной площадки комплекса АЭС ~72×72 м (масштаб 1:1 к росту человека 1.75 м и высоте энергоблоков)
  targetFootprintMeters: 72,
  scaleMultiplier: 1.0,
  centerXZ: true,
  alignBottomToZeroY: true,
  positionOffset: [0, 0, 0],
  effectScale: 0.9,
  markerScale: 0.88,
  spawn: {
    forwardMarginMeters: 2.2,
    lateralNormX: 0.0,
    eyeHeightMeters: 1.65,
    lookAtHeightRatio: 0.22,
    overviewDistanceFactor: 0.85,
    overviewElevationFactor: 0.45
  }
};

export interface FireZoneSpec {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
  /** Нормализованные координаты [-0.5..+0.5] относительно центра/размера Box3 модели (используются, если нет узла в .glb) */
  readonly relPos: readonly [number, number, number];
  /** Резервные мировые координаты в метрах (при 72×72 м) */
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
  /** Нормализованные координаты [-0.5..+0.5] относительно Box3 модели */
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

/**
 * Централизованная конфигурация поиска Empty-маркеров и привязки игровых зон к Box3 модели /assembly.glb.
 */
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

  // Относительные якоря внутри границ [-0.5..0.5] нормализованного Box3 (настил модели)
  defaultEntranceRelPos: [0.0, 0, 0.36],
  defaultAssemblyRelPos: [0.18, 0, 0.45],
  defaultPrimaryExtinguisherRelOffset: [-2.2, 0, -2.6],
  defaultSpareExtinguisherRelPos: [0.02, 0, 0.22],

  defaultSpawnPos: [0, 0, 38.2],
  defaultEntrancePos: [0, 0, 25.9],
  defaultAssemblyPos: [13.0, 0, 32.4],
  defaultPrimaryExtinguisherPos: [-2.2, 0, 35.6],
  defaultSpareExtinguisherPos: [1.4, 0, 15.8],

  defaultExits: [
    {
      id: 'EXIT_MAIN',
      nameRu: 'Главный выход с площадки (Юг)',
      relPos: [0.0, 0, 0.45],
      pos: [0, 0, 32.4]
    },
    {
      id: 'EXIT_EAST',
      nameRu: 'Восточный эваковыход',
      relPos: [0.38, 0, 0.20],
      pos: [27.4, 0, 14.4]
    }
  ],

  fireZones: [
    {
      id: 'fire_1',
      markerName: 'FIRE_ZONE_1',
      nameRu: 'Очаг №1: Кабельный ввод энергоблока №1 (Запад)',
      relPos: [-0.26, 0, 0.20],
      defaultPos: [-18.7, 0, 14.4],
      initialIntensity: 1.0,
      smokeDensity: 0.68,
      heatRadiusM: 3.4,
      radiusM: 1.05
    },
    {
      id: 'fire_2',
      markerName: 'FIRE_ZONE_2',
      nameRu: 'Очаг №2: Масляный узел энергоблока №2 (Восток)',
      relPos: [0.24, 0, 0.16],
      defaultPos: [17.3, 0, 11.5],
      initialIntensity: 1.0,
      smokeDensity: 0.78,
      heatRadiusM: 3.6,
      radiusM: 1.12
    },
    {
      id: 'fire_3',
      markerName: 'FIRE_ZONE_3',
      nameRu: 'Очаг №3: Распредщит межблочного проезда',
      relPos: [0.02, 0, -0.05],
      defaultPos: [1.4, 0, -3.6],
      initialIntensity: 0.85,
      smokeDensity: 0.62,
      heatRadiusM: 3.2,
      radiusM: 0.98
    }
  ],

  npcGroups: [
    {
      id: 'npc_group_1',
      markerName: 'NPC_GROUP_1',
      waypointPrefix: 'WAYPOINT_G1_',
      nameRu: 'Дежурная смена энергоблока №1 (2 чел.)',
      count: 2,
      relPos: [-0.33, 0, 0.04],
      relWaypoints: [
        [-0.22, 0, 0.20],
        [-0.08, 0, 0.34],
        [0.0, 0, 0.43]
      ],
      relExitPoint: [0.0, 0, 0.45],
      defaultPos: [-23.8, 0, 2.9],
      evacWaypoints: [
        [-15.8, 0, 14.4],
        [-5.8, 0, 24.5],
        [0.0, 0, 31.0]
      ],
      exitPoint: [0, 0, 32.4],
      blockedByFireId: 'fire_1',
      detectionRadiusM: 6.5,
      firePanicRadiusM: 18.0
    },
    {
      id: 'npc_group_2',
      markerName: 'NPC_GROUP_2',
      waypointPrefix: 'WAYPOINT_G2_',
      nameRu: 'Персонал машзала энергоблока №2 (2 чел.)',
      count: 2,
      relPos: [0.32, 0, -0.02],
      relWaypoints: [
        [0.24, 0, 0.16],
        [0.14, 0, 0.32],
        [0.04, 0, 0.43]
      ],
      relExitPoint: [0.0, 0, 0.45],
      defaultPos: [23.0, 0, -1.4],
      evacWaypoints: [
        [17.3, 0, 11.5],
        [10.1, 0, 23.0],
        [2.9, 0, 31.0]
      ],
      exitPoint: [0, 0, 32.4],
      blockedByFireId: 'fire_2',
      detectionRadiusM: 6.5,
      firePanicRadiusM: 18.0
    }
  ],

  triggerZones: [
    {
      id: 'TRIGGER_ENTRY_REACTOR',
      markerName: 'TRIGGER_ENTRY',
      kind: 'entry',
      nameRu: 'Контур входа на площадку энергоблоков',
      relPos: [0.0, 0, 0.36],
      defaultPos: [0, 0, 25.9],
      radiusM: 4.0
    },
    {
      id: 'TRIGGER_EVAC_CORRIDOR',
      markerName: 'TRIGGER_EVAC',
      kind: 'evac',
      nameRu: 'Восточный коридор эвакуации',
      relPos: [0.38, 0, 0.20],
      defaultPos: [27.4, 0, 14.4],
      radiusM: 4.2
    },
    {
      id: 'TRIGGER_ASSEMBLY_SAFE',
      markerName: 'TRIGGER_ASSEMBLY',
      kind: 'assembly',
      nameRu: 'Безопасный пункт сбора МЧС',
      relPos: [0.18, 0, 0.45],
      defaultPos: [13.0, 0, 32.4],
      radiusM: 4.8
    }
  ],

  wallColliders: []
};
