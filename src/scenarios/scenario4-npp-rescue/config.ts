/**
 * Конфигурация Сценария №4: Комплексный VR/Desktop тренажёр МЧС на базе 3D-модели комплекса АЭС (.glb)
 * Масштаб: 1 единица сцены = 1 метр. Высота глаз оператора: ~1.7 м (Desktop) / local-floor (VR).
 */

import * as THREE from 'three';

export type Scenario4StepId =
  | 'STEP_1_PREP_ENTRY'
  | 'STEP_2_FIRE_1'
  | 'STEP_3_EVAC_1'
  | 'STEP_4_FIRE_2_EVAC_2'
  | 'STEP_5_FINAL_SWEEP'
  | 'STEP_6_DEBRIEF';

export const SCENARIO4_STEP_ORDER: ReadonlyArray<Scenario4StepId> = [
  'STEP_1_PREP_ENTRY',
  'STEP_2_FIRE_1',
  'STEP_3_EVAC_1',
  'STEP_4_FIRE_2_EVAC_2',
  'STEP_5_FINAL_SWEEP',
  'STEP_6_DEBRIEF'
];

export interface Scenario4StepMeta {
  readonly id: Scenario4StepId;
  readonly stepNumber: number;
  readonly titleRu: string;
  readonly instructionRu: string;
}

export const SCENARIO4_STEPS: Readonly<Record<Scenario4StepId, Scenario4StepMeta>> = {
  STEP_1_PREP_ENTRY: {
    id: 'STEP_1_PREP_ENTRY',
    stepNumber: 1,
    titleRu: 'Подготовка СИЗ, ОУ-5 и вход',
    instructionRu: 'Возьмите ОУ-5 у входа [E], снимите чеку [E/R] и войдите в энергоблок.'
  },
  STEP_2_FIRE_1: {
    id: 'STEP_2_FIRE_1',
    stepNumber: 2,
    titleRu: 'Тушение очага в кабельной',
    instructionRu: 'Сбейте пламя в западном кабельном отсеке (удерживайте ЛКМ / [E] / курок).'
  },
  STEP_3_EVAC_1: {
    id: 'STEP_3_EVAC_1',
    stepNumber: 3,
    titleRu: 'Эвакуация группы персонала №1',
    instructionRu: 'Найдите дежурную смену в глубине отсека и подайте команду выхода [E].'
  },
  STEP_4_FIRE_2_EVAC_2: {
    id: 'STEP_4_FIRE_2_EVAC_2',
    stepNumber: 4,
    titleRu: 'Очаги машзала и группа №2',
    instructionRu: 'Потушите оставшиеся очаги (при необходимости замените баллон ОУ-5) и выведите группу №2.'
  },
  STEP_5_FINAL_SWEEP: {
    id: 'STEP_5_FINAL_SWEEP',
    stepNumber: 5,
    titleRu: 'Контрольный осмотр и выход',
    instructionRu: 'Убедитесь, что очаги = 0 и все эвакуированы, затем выйдите на пункт сбора.'
  },
  STEP_6_DEBRIEF: {
    id: 'STEP_6_DEBRIEF',
    stepNumber: 6,
    titleRu: 'Итоговый протокол МЧС',
    instructionRu: 'Аварийно-спасательная операция на комплексе АЭС завершена.'
  }
};

export interface WallColliderBox {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
  readonly minY: number;
  readonly maxY: number;
}

export interface FireZoneConfig {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
  readonly defaultPos: readonly [number, number, number];
  readonly initialIntensity: number; // 0..1
  readonly smokeDensity: number; // 0..1
  readonly heatRadiusM: number;
  readonly radiusM: number;
}

export interface NpcGroupConfig {
  readonly id: string;
  readonly markerName: string;
  readonly nameRu: string;
  readonly count: number;
  readonly defaultPos: readonly [number, number, number];
  readonly evacWaypoints: ReadonlyArray<readonly [number, number, number]>;
  readonly exitPoint: readonly [number, number, number];
  readonly blockedByFireId: string;
}

export interface Scenario4Config {
  readonly glbUrl: string;
  readonly dracoDecoderPath: string;
  readonly unitScale: number;
  readonly spawnPos: readonly [number, number, number];
  readonly entrancePos: readonly [number, number, number];
  readonly exitPositions: ReadonlyArray<{ id: string; nameRu: string; pos: readonly [number, number, number] }>;
  readonly assemblyPos: readonly [number, number, number];
  readonly primaryExtinguisherPos: readonly [number, number, number];
  readonly spareExtinguisherPos: readonly [number, number, number];
  readonly fireZones: ReadonlyArray<FireZoneConfig>;
  readonly npcGroups: ReadonlyArray<NpcGroupConfig>;
  readonly wallColliders: ReadonlyArray<WallColliderBox>;
}

export const SCENARIO4_DEFAULT_CONFIG: Scenario4Config = {
  glbUrl: './models/npp_complex.glb',
  dracoDecoderPath: './draco/',
  unitScale: 1.0,
  spawnPos: [0, 0, 21.5],
  entrancePos: [0, 0, 12.0],
  exitPositions: [
    { id: 'EXIT_MAIN', nameRu: 'Главный шлюз (Юг)', pos: [0, 0, 12.2] },
    { id: 'EXIT_EAST', nameRu: 'Эваковыход (Восток)', pos: [13.5, 0, 6.0] }
  ],
  assemblyPos: [0, 0, 21.0],
  primaryExtinguisherPos: [-1.8, 0, 13.4],
  spareExtinguisherPos: [1.8, 0, 2.2],
  fireZones: [
    {
      id: 'fire_1',
      markerName: 'FIRE_ZONE_1',
      nameRu: 'Очаг №1: Кабельный ввод 6 кВ',
      defaultPos: [-5.5, 0, 2.8],
      initialIntensity: 1.0,
      smokeDensity: 0.72,
      heatRadiusM: 4.0,
      radiusM: 1.25
    },
    {
      id: 'fire_2',
      markerName: 'FIRE_ZONE_2',
      nameRu: 'Очаг №2: Масляный узел машзала',
      defaultPos: [6.0, 0, -1.6],
      initialIntensity: 1.0,
      smokeDensity: 0.85,
      heatRadiusM: 4.4,
      radiusM: 1.35
    },
    {
      id: 'fire_3',
      markerName: 'FIRE_ZONE_3',
      nameRu: 'Очаг №3: Распредщит коридора',
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
      nameRu: 'Дежурная смена щитовой (2 чел.)',
      count: 2,
      defaultPos: [-9.8, 0, -2.4],
      evacWaypoints: [
        [-8.0, 0, 1.5],
        [-5.2, 0, 3.0],
        [-1.8, 0, 7.5]
      ],
      exitPoint: [0, 0, 13.5],
      blockedByFireId: 'fire_1'
    },
    {
      id: 'npc_group_2',
      markerName: 'NPC_GROUP_2',
      nameRu: 'Персонал машзала (2 чел.)',
      count: 2,
      defaultPos: [9.6, 0, -7.8],
      evacWaypoints: [
        [8.5, 0, -4.0],
        [6.2, 0, 0.2],
        [8.2, 0, 5.4]
      ],
      exitPoint: [15.5, 0, 6.0],
      blockedByFireId: 'fire_2'
    }
  ],
  // Стены здания энергоблока (X: -14..14, Z: -14..12) с широкими проёмами (3.6..4.4 м)
  wallColliders: [
    // Южный фасад (y-вход по центру X: -2.2..2.2 открыт)
    { minX: -14.2, maxX: -2.2, minZ: 11.75, maxZ: 12.25, minY: 0, maxY: 4.8 },
    { minX: 2.2, maxX: 14.2, minZ: 11.75, maxZ: 12.25, minY: 0, maxY: 4.8 },
    // Северная стена
    { minX: -14.2, maxX: 14.2, minZ: -14.25, maxZ: -13.75, minY: 0, maxY: 4.8 },
    // Западная стена
    { minX: -14.25, maxX: -13.75, minZ: -14.0, maxZ: 12.0, minY: 0, maxY: 4.8 },
    // Восточная стена (проём восточного выхода Z: 4.2..7.8 открыт)
    { minX: 13.75, maxX: 14.25, minZ: -14.0, maxZ: 4.2, minY: 0, maxY: 4.8 },
    { minX: 13.75, maxX: 14.25, minZ: 7.8, maxZ: 12.0, minY: 0, maxY: 4.8 },
    // Внутренняя перегородка западного крыла (проход Z: 1.0..4.8 открыт)
    { minX: -3.25, maxX: -2.75, minZ: -13.8, maxZ: 1.0, minY: 0, maxY: 4.8 },
    { minX: -3.25, maxX: -2.75, minZ: 4.8, maxZ: 11.8, minY: 0, maxY: 4.8 },
    // Внутренняя перегородка восточного машзала (проход Z: -3.6..0.4 и Z: 4.0..7.5)
    { minX: 3.25, maxX: 3.75, minZ: -13.8, maxZ: -3.6, minY: 0, maxY: 4.8 },
    { minX: 3.25, maxX: 3.75, minZ: 0.4, maxZ: 4.0, minY: 0, maxY: 4.8 },
    { minX: 3.25, maxX: 3.75, minZ: 7.5, maxZ: 11.8, minY: 0, maxY: 4.8 }
  ]
};

export interface DiscoveredMarkers {
  spawnPlayer: THREE.Vector3;
  entrances: Array<{ name: string; pos: THREE.Vector3 }>;
  exits: Array<{ name: string; pos: THREE.Vector3 }>;
  evacPoints: Array<{ name: string; pos: THREE.Vector3 }>;
  fireZones: Array<{ name: string; pos: THREE.Vector3 }>;
  npcGroups: Array<{ name: string; pos: THREE.Vector3 }>;
  extinguisherPoints: Array<{ name: string; pos: THREE.Vector3 }>;
}

export type ExtinguisherStatus = 'ON_POST' | 'HELD_LOCKED' | 'ARMED' | 'EMPTY';

export type NpcGroupStatus = 'TRAPPED' | 'BLOCKED_BY_FIRE' | 'FOLLOWING' | 'EVACUATED';

export interface Scenario4DebriefSummary {
  readonly elapsedSec: number;
  readonly rescuedCount: number;
  readonly totalNpcCount: number;
  readonly extinguishedFires: number;
  readonly totalFires: number;
  readonly remainingExtinguisherPct: number;
  readonly cylindersUsed: number;
  readonly cumulativeDoseMsv: number;
  readonly peakHeatLoadPct: number;
  readonly safetyErrors: ReadonlyArray<string>;
  readonly grade: 'A' | 'B' | 'C';
  readonly gradeLabelRu: string;
}

export interface Scenario4HudSnapshot {
  readonly isLoadingGlb: boolean;
  readonly loadProgressPct: number;
  readonly loadStatusRu: string;
  readonly usingProceduralFallback: boolean;
  readonly stepId: Scenario4StepId;
  readonly stepNumber: number;
  readonly totalSteps: number;
  readonly stepTitleRu: string;
  readonly instructionRu: string;
  readonly firesExtinguished: number;
  readonly totalFires: number;
  readonly rescuedCount: number;
  readonly totalNpcCount: number;
  readonly extinguisherStatus: ExtinguisherStatus;
  readonly extinguisherChargePct: number;
  readonly isSpraying: boolean;
  readonly isInsideBuilding: boolean;
  readonly inAssemblyZone: boolean;
  readonly thermalHeatLoad01: number;
  readonly smokeExposure01: number;
  readonly elapsedSec: number;
  readonly cumulativeDoseMsv: number;
  readonly targetPromptRu: string | null;
  readonly warningBannerRu: string | null;
  readonly safetyErrorCount: number;
  readonly debrief: Scenario4DebriefSummary | null;
}
