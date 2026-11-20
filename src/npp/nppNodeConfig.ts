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
  rotationDeg: [-90, 0, 0],
  orientationMode: 'auto_z_up',
  targetFootprintMeters: 38,
  scaleMultiplier: 1.0,
  centerXZ: true,
  alignBottomToZeroY: true,
  positionOffset: [0, 0, 0],
  effectScale: 0.62,
  markerScale: 0.78,
  spawn: {
    forwardMarginMeters: 4.8,
    lateralNormX: 0.0,
    eyeHeightMeters: 1.65,
    lookAtHeightRatio: 0.24,
    overviewDistanceFactor: 0.78,
    overviewElevationFactor: 0.44
  }
};

export interface FireZoneSpec {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
  /** Нормализованные координаты [-0.5..+0.5] относительно центра/размера Box3 модели (используются, если нет узла в .glb) */
  readonly relPos: readonly [number, number, number];
  /** Резервные мировые координаты в метрах (при 38×38 м) */
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

  // Относительные якоря на плоскости нормализованного Box3 (X, Z в [-0.5..0.5], Y=0 настил)
  defaultEntranceRelPos: [0.0, 0, 0.44],
  defaultAssemblyRelPos: [0.0, 0, 0.62],
  defaultPrimaryExtinguisherRelOffset: [-2.0, 0, -2.1],
  defaultSpareExtinguisherRelPos: [0.02, 0, 0.24],

  defaultSpawnPos: [0, 0, 23.8],
  defaultEntrancePos: [0, 0, 16.7],
  defaultAssemblyPos: [0, 0, 23.6],
  defaultPrimaryExtinguisherPos: [-2.0, 0, 21.7],
  defaultSpareExtinguisherPos: [0.8, 0, 9.1],

  defaultExits: [
    {
      id: 'EXIT_MAIN',
      nameRu: 'Главный выход с площадки (Юг)',
      relPos: [0.0, 0, 0.47],
      pos: [0, 0, 17.8]
    },
    {
      id: 'EXIT_EAST',
      nameRu: 'Восточный эваковыход',
      relPos: [0.42, 0, 0.22],
      pos: [16.0, 0, 8.4]
    }
  ],

  fireZones: [
    {
      id: 'fire_1',
      markerName: 'FIRE_ZONE_1',
      nameRu: 'Очаг №1: Кабельный ввод энергоблока №1 (Запад)',
      relPos: [-0.26, 0, 0.21],
      defaultPos: [-9.9, 0, 8.0],
      initialIntensity: 1.0,
      smokeDensity: 0.68,
      heatRadiusM: 3.1,
      radiusM: 0.92
    },
    {
      id: 'fire_2',
      markerName: 'FIRE_ZONE_2',
      nameRu: 'Очаг №2: Масляный узел энергоблока №2 (Восток)',
      relPos: [0.24, 0, 0.16],
      defaultPos: [9.1, 0, 6.1],
      initialIntensity: 1.0,
      smokeDensity: 0.78,
      heatRadiusM: 3.3,
      radiusM: 0.98
    },
    {
      id: 'fire_3',
      markerName: 'FIRE_ZONE_3',
      nameRu: 'Очаг №3: Распредщит межблочного проезда',
      relPos: [0.02, 0, -0.05],
      defaultPos: [0.8, 0, -1.9],
      initialIntensity: 0.85,
      smokeDensity: 0.62,
      heatRadiusM: 2.9,
      radiusM: 0.88
    }
  ],

  npcGroups: [
    {
      id: 'npc_group_1',
      markerName: 'NPC_GROUP_1',
      waypointPrefix: 'WAYPOINT_G1_',
      nameRu: 'Дежурная смена энергоблока №1 (2 чел.)',
      count: 2,
      relPos: [-0.34, 0, 0.04],
      relWaypoints: [
        [-0.22, 0, 0.20],
        [-0.08, 0, 0.34],
        [0.0, 0, 0.45]
      ],
      relExitPoint: [0.0, 0, 0.48],
      defaultPos: [-12.9, 0, 1.5],
      evacWaypoints: [
        [-8.4, 0, 7.6],
        [-3.0, 0, 12.9],
        [0.0, 0, 17.1]
      ],
      exitPoint: [0, 0, 18.2],
      blockedByFireId: 'fire_1',
      detectionRadiusM: 5.5,
      firePanicRadiusM: 9.5
    },
    {
      id: 'npc_group_2',
      markerName: 'NPC_GROUP_2',
      waypointPrefix: 'WAYPOINT_G2_',
      nameRu: 'Персонал машзала энергоблока №2 (2 чел.)',
      count: 2,
      relPos: [0.33, 0, -0.02],
      relWaypoints: [
        [0.24, 0, 0.16],
        [0.14, 0, 0.32],
        [0.04, 0, 0.44]
      ],
      relExitPoint: [0.0, 0, 0.48],
      defaultPos: [12.5, 0, -0.8],
      evacWaypoints: [
        [9.1, 0, 6.1],
        [5.3, 0, 12.2],
        [1.5, 0, 16.7]
      ],
      exitPoint: [0, 0, 18.2],
      blockedByFireId: 'fire_2',
      detectionRadiusM: 5.5,
      firePanicRadiusM: 9.5
    }
  ],

  triggerZones: [
    {
      id: 'TRIGGER_ENTRY_REACTOR',
      markerName: 'TRIGGER_ENTRY',
      kind: 'entry',
      nameRu: 'Контур входа на площадку энергоблоков',
      relPos: [0.0, 0, 0.44],
      defaultPos: [0, 0, 16.7],
      radiusM: 3.4
    },
    {
      id: 'TRIGGER_EVAC_CORRIDOR',
      markerName: 'TRIGGER_EVAC',
      kind: 'evac',
      nameRu: 'Восточный коридор эвакуации',
      relPos: [0.42, 0, 0.22],
      defaultPos: [16.0, 0, 8.4],
      radiusM: 3.5
    },
    {
      id: 'TRIGGER_ASSEMBLY_SAFE',
      markerName: 'TRIGGER_ASSEMBLY',
      kind: 'assembly',
      nameRu: 'Безопасный пункт сбора МЧС',
      relPos: [0.0, 0, 0.62],
      defaultPos: [0, 0, 23.6],
      radiusM: 4.2
    }
  ],

  wallColliders: []
};
