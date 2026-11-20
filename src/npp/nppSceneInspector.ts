/**
 * ALARA — Инспектор иерархии графа сцены АЭС (.glb)
 * Выполняет scene.traverse по загруженной 3D-модели /assembly.glb,
 * регистрирует игровые узлы по префиксам из NPP_NODE_CONFIG,
 * вычисляет мировые координаты, фиксирует отсутствующие узлы и формирует отчёт.
 */

import * as THREE from 'three';
import { NppAssemblyConfig, WallColliderBox } from './nppNodeConfig';

export interface NamedWorldMarker {
  readonly name: string;
  readonly pos: THREE.Vector3;
}

export interface InspectedNodeEntry {
  readonly category: string;
  readonly nodeName: string;
  readonly worldPosition: readonly [number, number, number];
  readonly usedFallback: boolean;
}

export type NppSceneSourceKind = 'glb_file' | 'custom_upload';

export interface DiscoveredNppMarkers {
  readonly spawnPlayer: THREE.Vector3;
  readonly spawnLookTarget: THREE.Vector3;
  readonly focusCameraPos: THREE.Vector3;
  readonly focusCameraTarget: THREE.Vector3;
  readonly entrances: NamedWorldMarker[];
  readonly exits: NamedWorldMarker[];
  readonly assemblyPoints: NamedWorldMarker[];
  readonly evacPoints: NamedWorldMarker[];
  readonly fireZones: NamedWorldMarker[];
  readonly npcSpawns: NamedWorldMarker[];
  readonly waypoints: NamedWorldMarker[];
  readonly triggers: NamedWorldMarker[];
  readonly pois: NamedWorldMarker[];
  readonly extinguisherPoints: NamedWorldMarker[];
  readonly wallColliders: WallColliderBox[];
}

export interface NppInspectionReport {
  readonly sourceKind: NppSceneSourceKind;
  readonly sourceUrl: string;
  readonly totalNodes: number;
  readonly totalMeshes: number;
  readonly boundingBoxMin: readonly [number, number, number];
  readonly boundingBoxMax: readonly [number, number, number];
  readonly boundingBoxCenter: readonly [number, number, number];
  readonly boundingBoxSize: readonly [number, number, number];
  readonly keyNodeNames: ReadonlyArray<string>;
  readonly discoveredNodes: ReadonlyArray<InspectedNodeEntry>;
  readonly missingExpectedNodes: ReadonlyArray<string>;
  readonly markers: DiscoveredNppMarkers;
}

function matchesAnyPrefix(upperName: string, prefixes: ReadonlyArray<string>): boolean {
  for (let i = 0; i < prefixes.length; i++) {
    if (upperName.startsWith(prefixes[i].toUpperCase())) {
      return true;
    }
  }
  return false;
}

function roundCoords(v: THREE.Vector3): readonly [number, number, number] {
  return [Number(v.x.toFixed(2)), Number(v.y.toFixed(2)), Number(v.z.toFixed(2))];
}

/**
 * Проводит полный обход графа сцены (.glb), регистрирует ключевые узлы,
 * вычисляет габариты Box3, валидную точку спавна и обзорную позицию камеры,
 * а также выводит структуру узлов и Box3 в консоль.
 */
export function inspectNppSceneGraph(
  root: THREE.Object3D,
  config: NppAssemblyConfig,
  sourceKind: NppSceneSourceKind,
  sourceUrl: string
): NppInspectionReport {
  root.updateMatrixWorld(true);

  const discoveredNodes: InspectedNodeEntry[] = [];
  const missingExpectedNodes: string[] = [];
  const keyNodeNames: string[] = [];

  const spawnCandidates: NamedWorldMarker[] = [];
  const entrances: NamedWorldMarker[] = [];
  const exits: NamedWorldMarker[] = [];
  const assemblyPoints: NamedWorldMarker[] = [];
  const evacPoints: NamedWorldMarker[] = [];
  const fireZones: NamedWorldMarker[] = [];
  const npcSpawns: NamedWorldMarker[] = [];
  const waypoints: NamedWorldMarker[] = [];
  const triggers: NamedWorldMarker[] = [];
  const pois: NamedWorldMarker[] = [];
  const extinguisherPoints: NamedWorldMarker[] = [];
  const wallColliders: WallColliderBox[] = [];

  let totalNodes = 0;
  let totalMeshes = 0;

  const wp = new THREE.Vector3();
  const box3 = new THREE.Box3();
  const sceneBounds = new THREE.Box3();
  const centerVec = new THREE.Vector3();
  const sizeVec = new THREE.Vector3();

  const { prefixes } = config;

  root.traverse(obj => {
    totalNodes += 1;
    const isMesh = Boolean((obj as THREE.Mesh).isMesh);
    if (isMesh) {
      totalMeshes += 1;
    }

    const rawName = obj.name?.trim() ?? '';
    if (!rawName) return;

    if (keyNodeNames.length < 80) {
      keyNodeNames.push(isMesh ? `${rawName} [Mesh]` : rawName);
    }

    const upper = rawName.toUpperCase();
    obj.getWorldPosition(wp);

    const record = (category: string, list: NamedWorldMarker[]) => {
      const cloned = wp.clone();
      list.push({ name: rawName, pos: cloned });
      discoveredNodes.push({
        category,
        nodeName: rawName,
        worldPosition: roundCoords(cloned),
        usedFallback: false
      });
    };

    if (matchesAnyPrefix(upper, prefixes.playerSpawn)) {
      record('playerSpawn', spawnCandidates);
    } else if (matchesAnyPrefix(upper, prefixes.entrances)) {
      record('entrance', entrances);
    } else if (matchesAnyPrefix(upper, prefixes.exits)) {
      record('exit', exits);
    } else if (matchesAnyPrefix(upper, prefixes.assemblyPoints)) {
      record('assembly', assemblyPoints);
    } else if (matchesAnyPrefix(upper, prefixes.evacPoints)) {
      record('evacPoint', evacPoints);
    } else if (matchesAnyPrefix(upper, prefixes.fireZones)) {
      record('fireZone', fireZones);
    } else if (matchesAnyPrefix(upper, prefixes.npcSpawns)) {
      record('npcSpawn', npcSpawns);
    } else if (matchesAnyPrefix(upper, prefixes.waypoints)) {
      record('waypoint', waypoints);
    } else if (matchesAnyPrefix(upper, prefixes.triggers)) {
      record('trigger', triggers);
    } else if (matchesAnyPrefix(upper, prefixes.pois)) {
      record('poi', pois);
    } else if (matchesAnyPrefix(upper, prefixes.extinguishers)) {
      record('extinguisher', extinguisherPoints);
    }

    if (isMesh && prefixes.colliderKeywords.some(kw => upper.includes(kw.toUpperCase()))) {
      box3.setFromObject(obj);
      if (!box3.isEmpty()) {
        wallColliders.push({
          minX: box3.min.x,
          maxX: box3.max.x,
          minY: box3.min.y,
          maxY: box3.max.y,
          minZ: box3.min.z,
          maxZ: box3.max.z
        });
      }
    }
  });

  // Сортируем waypoint-узлы по имени (WAYPOINT_G1_01, WAYPOINT_G1_02...)
  waypoints.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  sceneBounds.setFromObject(root);
  if (!sceneBounds.isEmpty()) {
    sceneBounds.getSize(sizeVec);
    sceneBounds.getCenter(centerVec);
  } else {
    sceneBounds.min.set(-10, 0, -10);
    sceneBounds.max.set(10, 5, 10);
    sizeVec.set(20, 5, 20);
    centerVec.set(0, 2.5, 0);
  }

  const floorY = Number.isFinite(sceneBounds.min.y) ? sceneBounds.min.y : 0;
  const horizExtent = Math.max(sizeVec.x, sizeVec.z, 8);
  const diag = Math.max(sizeVec.length(), 12);

  // Точка обзора всего комплекса (для отладки и клавиши [K])
  const focusCameraTarget = centerVec.clone();
  const focusCameraPos = new THREE.Vector3(
    centerVec.x + sizeVec.x * 0.14,
    floorY + Math.max(3.2, Math.min(45, sizeVec.y * 0.55 + diag * 0.18)),
    sceneBounds.max.z + Math.max(6.5, Math.min(85, diag * 0.55))
  );

  // Валидная стартовая точка игрока: либо узел SPAWN_PLAYER из .glb, либо перед входом в модель Box3
  let spawnPlayer: THREE.Vector3;
  const spawnLookTarget = centerVec.clone();
  spawnLookTarget.y = floorY + Math.min(3.5, Math.max(1.4, sizeVec.y * 0.3));

  if (spawnCandidates.length > 0) {
    spawnPlayer = spawnCandidates[0].pos.clone();
  } else {
    const frontOffsetZ = Math.max(3.5, Math.min(18, horizExtent * 0.22));
    spawnPlayer = new THREE.Vector3(centerVec.x, floorY, sceneBounds.max.z + frontOffsetZ);
    missingExpectedNodes.push(
      `SPAWN_PLAYER (авто-спавн по Box3: [${roundCoords(spawnPlayer).join(', ')}])`
    );
    discoveredNodes.push({
      category: 'playerSpawn',
      nodeName: 'AUTO_BOX3_SPAWN_PLAYER',
      worldPosition: roundCoords(spawnPlayer),
      usedFallback: true
    });
  }

  if (entrances.length === 0) {
    const autoEntrance = new THREE.Vector3(
      centerVec.x,
      floorY,
      Math.max(sceneBounds.min.z, sceneBounds.max.z - Math.min(4.0, sizeVec.z * 0.12))
    );
    missingExpectedNodes.push(`ENTRANCE_* (авто: [${roundCoords(autoEntrance).join(', ')}])`);
    entrances.push({ name: 'AUTO_ENTRANCE_MAIN', pos: autoEntrance });
  }

  if (exits.length === 0) {
    missingExpectedNodes.push('EXIT_* (авто-точки эваковыхода у границ модели)');
    exits.push(
      { name: 'EXIT_MAIN', pos: new THREE.Vector3(centerVec.x, floorY, sceneBounds.max.z) },
      { name: 'EXIT_EAST', pos: new THREE.Vector3(sceneBounds.max.x, floorY, centerVec.z) }
    );
  }

  if (assemblyPoints.length === 0) {
    const autoAssembly = new THREE.Vector3(
      spawnPlayer.x,
      floorY,
      spawnPlayer.z + 2.5
    );
    missingExpectedNodes.push(`ASSEMBLY_* (авто: [${roundCoords(autoAssembly).join(', ')}])`);
    assemblyPoints.push({ name: 'AUTO_ASSEMBLY_MAIN', pos: autoAssembly });
  }

  if (extinguisherPoints.length === 0) {
    const primaryPost = new THREE.Vector3(spawnPlayer.x - 1.8, floorY, spawnPlayer.z - 2.4);
    const sparePost = new THREE.Vector3(centerVec.x + 2.2, floorY, centerVec.z + 2.2);
    missingExpectedNodes.push('EXTINGUISHER_POINT_* (размещены рядом со стартом и центром)');
    extinguisherPoints.push(
      { name: 'AUTO_EXTINGUISHER_1', pos: primaryPost },
      { name: 'AUTO_EXTINGUISHER_SPARE', pos: sparePost }
    );
  }

  config.fireZones.forEach(fz => {
    const found = fireZones.find(m => m.name.toUpperCase().startsWith(fz.markerName.toUpperCase()));
    if (!found) {
      missingExpectedNodes.push(`${fz.markerName} (не найден в .glb, применён коорд. пресет)`);
    }
  });

  config.npcGroups.forEach(ng => {
    const found = npcSpawns.find(m => m.name.toUpperCase().startsWith(ng.markerName.toUpperCase()));
    if (!found) {
      missingExpectedNodes.push(`${ng.markerName} (не найден в .glb, применён коорд. пресет)`);
    }
  });

  const report: NppInspectionReport = {
    sourceKind,
    sourceUrl,
    totalNodes,
    totalMeshes,
    boundingBoxMin: roundCoords(sceneBounds.min),
    boundingBoxMax: roundCoords(sceneBounds.max),
    boundingBoxCenter: roundCoords(centerVec),
    boundingBoxSize: roundCoords(sizeVec),
    keyNodeNames,
    discoveredNodes,
    missingExpectedNodes,
    markers: {
      spawnPlayer,
      spawnLookTarget,
      focusCameraPos,
      focusCameraTarget,
      entrances,
      exits,
      assemblyPoints,
      evacPoints,
      fireZones,
      npcSpawns,
      waypoints,
      triggers,
      pois,
      extinguisherPoints,
      wallColliders
    }
  };

  console.groupCollapsed(
    `[ALARA GLB Inspector] ${sourceUrl} | Узлов: ${totalNodes} | Мешей: ${totalMeshes} | Габариты Box3: ${report.boundingBoxSize.join('×')} м`
  );
  console.info('Box3 min:', report.boundingBoxMin, 'max:', report.boundingBoxMax, 'center:', report.boundingBoxCenter);
  console.info(`Ключевые узлы (${keyNodeNames.length} показаны из ${totalNodes}):`, keyNodeNames);
  if (missingExpectedNodes.length > 0) {
    console.info('Авто-разрешённые игровые маркеры (отсутствуют в .glb):', missingExpectedNodes);
  }
  console.groupEnd();

  return report;
}
