/**
 * ALARA — Единая конфигурация узлов/префиксов 3D-модели комплекса АЭС (/assembly.glb)
 * и запасных (fallback) координат для Сценария №4.
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

export interface FireZoneSpec {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
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
  readonly targetUnitScale: number;
  readonly alignBottomToZeroY: boolean;
  readonly prefixes: NppNodePrefixesConfig;
  readonly defaultSpawnPos: readonly [number, number, number];
  readonly defaultEntrancePos: readonly [number, number, number];
  readonly defaultAssemblyPos: readonly [number, number, number];
  readonly defaultPrimaryExtinguisherPos: readonly [number, number, number];
  readonly defaultSpareExtinguisherPos: readonly [number, number, number];
  readonly defaultExits: ReadonlyArray<{
    readonly id: string;
    readonly nameRu: string;
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
 * Централизованная конфигурация поиска Empty-маркеров и мешей внутри public/assembly.glb.
 * Для адаптации под сторонний .glb достаточно изменить префиксы в объекте `prefixes`.
 */
export const NPP_NODE_CONFIG: NppAssemblyConfig = {
  glbUrl: `${BASE_URL}assembly.glb`,
  dracoDecoderPath: `${BASE_URL}draco/gltf/`,
  targetUnitScale: 1.0,
  alignBottomToZeroY: true,

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

  defaultSpawnPos: [0, 0, 21.5],
  defaultEntrancePos: [0, 0, 12.0],
  defaultAssemblyPos: [0, 0, 21.0],
  defaultPrimaryExtinguisherPos: [-1.8, 0, 13.4],
  defaultSpareExtinguisherPos: [1.8, 0, 2.2],

  defaultExits: [
    { id: 'EXIT_MAIN', nameRu: 'Главный шлюз энергоблока (Юг)', pos: [0, 0, 12.2] },
    { id: 'EXIT_EAST', nameRu: 'Восточный эваковыход', pos: [13.5, 0, 6.0] }
  ],

  fireZones: [
    {
      id: 'fire_1',
      markerName: 'FIRE_ZONE_1',
      nameRu: 'Очаг №1: Кабельный ввод 6 кВ (западное крыло)',
      defaultPos: [-5.5, 0, 2.8],
      initialIntensity: 1.0,
      smokeDensity: 0.72,
      heatRadiusM: 4.0,
      radiusM: 1.25
    },
    {
      id: 'fire_2',
      markerName: 'FIRE_ZONE_2',
      nameRu: 'Очаг №2: Масляный узел машзала (восток)',
      defaultPos: [6.0, 0, -1.6],
      initialIntensity: 1.0,
      smokeDensity: 0.85,
      heatRadiusM: 4.4,
      radiusM: 1.35
    },
    {
      id: 'fire_3',
      markerName: 'FIRE_ZONE_3',
      nameRu: 'Очаг №3: Распредщит коридора эвакуации',
      defaultPos: [8.8, 0, 5.2],
      initialIntensity: 0.85,
      smokeDensity: 0.65,
      heatRadiusM: 3.6,
      radiusM: 1.15
    }
  ],

  npcGroups: [
    {
      id: 'npc_group_1',
      markerName: 'NPC_GROUP_1',
      waypointPrefix: 'WAYPOINT_G1_',
      nameRu: 'Дежурная смена щитовой (2 чел.)',
      count: 2,
      defaultPos: [-9.8, 0, -2.4],
      evacWaypoints: [
        [-8.0, 0, 1.5],
        [-5.2, 0, 3.0],
        [-1.8, 0, 7.5]
      ],
      exitPoint: [0, 0, 13.5],
      blockedByFireId: 'fire_1',
      detectionRadiusM: 5.5,
      firePanicRadiusM: 10.5
    },
    {
      id: 'npc_group_2',
      markerName: 'NPC_GROUP_2',
      waypointPrefix: 'WAYPOINT_G2_',
      nameRu: 'Персонал машзала (2 чел.)',
      count: 2,
      defaultPos: [9.6, 0, -7.8],
      evacWaypoints: [
        [8.5, 0, -4.0],
        [6.2, 0, 0.2],
        [8.2, 0, 5.4]
      ],
      exitPoint: [15.5, 0, 6.0],
      blockedByFireId: 'fire_2',
      detectionRadiusM: 5.5,
      firePanicRadiusM: 10.5
    }
  ],

  triggerZones: [
    {
      id: 'TRIGGER_ENTRY_REACTOR',
      markerName: 'TRIGGER_ENTRY',
      kind: 'entry',
      nameRu: 'Шлюз входа в аварийный корпус АЭС',
      defaultPos: [0, 0, 11.4],
      radiusM: 3.2
    },
    {
      id: 'TRIGGER_EVAC_CORRIDOR',
      markerName: 'TRIGGER_EVAC',
      kind: 'evac',
      nameRu: 'Коридор эвакуации (Восток)',
      defaultPos: [13.5, 0, 6.0],
      radiusM: 3.5
    },
    {
      id: 'TRIGGER_ASSEMBLY_SAFE',
      markerName: 'TRIGGER_ASSEMBLY',
      kind: 'assembly',
      nameRu: 'Безопасный пункт сбора МЧС',
      defaultPos: [0, 0, 21.0],
      radiusM: 4.2
    }
  ],

  // Коллайдеры стен корпуса энергоблока (используются для процедурного макета и резервного fallback)
  wallColliders: [
    { minX: -14.2, maxX: -2.2, minZ: 11.75, maxZ: 12.25, minY: 0, maxY: 4.8 },
    { minX: 2.2, maxX: 14.2, minZ: 11.75, maxZ: 12.25, minY: 0, maxY: 4.8 },
    { minX: -14.2, maxX: 14.2, minZ: -14.25, maxZ: -13.75, minY: 0, maxY: 4.8 },
    { minX: -14.25, maxX: -13.75, minZ: -14.0, maxZ: 12.0, minY: 0, maxY: 4.8 },
    { minX: 13.75, maxX: 14.25, minZ: -14.0, maxZ: 4.2, minY: 0, maxY: 4.8 },
    { minX: 13.75, maxX: 14.25, minZ: 7.8, maxZ: 12.0, minY: 0, maxY: 4.8 },
    { minX: -3.25, maxX: -2.75, minZ: -13.8, maxZ: 1.0, minY: 0, maxY: 4.8 },
    { minX: -3.25, maxX: -2.75, minZ: 4.8, maxZ: 11.8, minY: 0, maxY: 4.8 },
    { minX: 3.25, maxX: 3.75, minZ: -13.8, maxZ: -3.6, minY: 0, maxY: 4.8 },
    { minX: 3.25, maxX: 3.75, minZ: 0.4, maxZ: 4.0, minY: 0, maxY: 4.8 },
    { minX: 3.25, maxX: 3.75, minZ: 7.5, maxZ: 11.8, minY: 0, maxY: 4.8 }
  ]
};
