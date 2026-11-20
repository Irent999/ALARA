/**
 * ALARA — Инспектор иерархии графа сцены АЭС (.glb)
 * Выполняет scene.traverse по нормализованной 3D-модели /assembly.glb,
 * регистрирует игровые узлы по префиксам из NPP_NODE_CONFIG,
 * привязывает координаты огня/NPC/точек входа и спавна к реальному Box3 и поверхности модели.
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

export interface NamedNodeWorldCoord {
  readonly name: string;
  readonly kind: 'Mesh' | 'Node';
  readonly worldPosition: readonly [number, number, number];
}

export interface NormalizationMetrics {
  readonly rawBoundingBoxMin: readonly [number, number, number];
  readonly rawBoundingBoxMax: readonly [number, number, number];
  readonly rawBoundingBoxSize: readonly [number, number, number];
  readonly appliedRotationDeg: readonly [number, number, number];
  readonly appliedScale: number;
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
  readonly rawBoundingBoxMin: readonly [number, number, number];
  readonly rawBoundingBoxMax: readonly [number, number, number];
  readonly rawBoundingBoxSize: readonly [number, number, number];
  readonly appliedRotationDeg: readonly [number, number, number];
  readonly appliedScale: number;
  readonly deckSurfaceY: number;
  readonly boundingBoxMin: readonly [number, number, number];
  readonly boundingBoxMax: readonly [number, number, number];
  readonly boundingBoxCenter: readonly [number, number, number];
  readonly boundingBoxSize: readonly [number, number, number];
  readonly keyNodeNames: ReadonlyArray<string>;
  readonly namedNodeCoords: ReadonlyArray<NamedNodeWorldCoord>;
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
 * Определяет высоту горизонтальной площадки/пола модели (.glb) с помощью нисходящих лучей
 * в пределах разумной высоты цоколя (чтобы не принимать крыши градирен за уровень земли).
 */
function sampleGroundDeckY(root: THREE.Object3D, bounds: THREE.Box3, meshes: THREE.Mesh[]): number {
  const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
  if (bounds.isEmpty() || meshes.length === 0) return minY;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const maxDeckDelta = Math.max(0.6, Math.min(2.4, size.y * 0.16));

  const samples: number[] = [];
  const offsets = [-0.42, -0.25, 0, 0.25, 0.42];
  for (let ix = 0; ix < offsets.length; ix++) {
    for (let iz = 0; iz < offsets.length; iz++) {
      origin.set(
        center.x + offsets[ix] * size.x,
        bounds.max.y + 2.0,
        center.z + offsets[iz] * size.z
      );
      raycaster.set(origin, down);
      const hits = raycaster.intersectObjects(meshes, false);
      for (let h = 0; h < hits.length; h++) {
        const y = hits[h].point.y;
        if (y >= minY - 0.05 && y <= minY + maxDeckDelta) {
          samples.push(y);
          break;
        }
      }
    }
  }

  if (samples.length === 0) return minY;
  samples.sort((a, b) => a - b);
  const idx = Math.floor(samples.length * 0.35);
  return Number(samples[idx].toFixed(3));
}

function sampleSurfaceYAt(
  x: number,
  z: number,
  bounds: THREE.Box3,
  meshes: THREE.Mesh[],
  deckY: number
): number {
  if (meshes.length === 0 || bounds.isEmpty()) return deckY;
  if (x < bounds.min.x || x > bounds.max.x || z < bounds.min.z || z > bounds.max.z) {
    return deckY;
  }

  const sizeY = bounds.max.y - bounds.min.y;
  const maxStepY = deckY + Math.max(0.5, Math.min(1.6, sizeY * 0.12));

  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, bounds.max.y + 1.5, z),
    new THREE.Vector3(0, -1, 0)
  );
  const hits = raycaster.intersectObjects(meshes, false);
  for (let i = hits.length - 1; i >= 0; i--) {
    const hy = hits[i].point.y;
    if (hy >= bounds.min.y - 0.05 && hy <= maxStepY) {
      return hy;
    }
  }
  return deckY;
}

/**
 * Проводит полный обход графа нормализованной сцены (.glb), регистрирует ключевые узлы,
 * вычисляет габариты Box3, высоту площадки deckSurfaceY, валидную точку спавна и позиции игровых зон.
 */
export function inspectNppSceneGraph(
  root: THREE.Object3D,
  config: NppAssemblyConfig,
  sourceKind: NppSceneSourceKind,
  sourceUrl: string,
  normMetrics?: NormalizationMetrics
): NppInspectionReport {
  root.updateMatrixWorld(true);

  const discoveredNodes: InspectedNodeEntry[] = [];
  const missingExpectedNodes: string[] = [];
  const keyNodeNames: string[] = [];
  const namedNodeCoords: NamedNodeWorldCoord[] = [];
  const allMeshes: THREE.Mesh[] = [];

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

  const { prefixes, transform } = config;

  root.traverse(obj => {
    totalNodes += 1;
    const isMesh = Boolean((obj as THREE.Mesh).isMesh);
    if (isMesh) {
      totalMeshes += 1;
      allMeshes.push(obj as THREE.Mesh);
    }

    const rawName = obj.name?.trim() ?? '';
    if (!rawName) return;

    obj.getWorldPosition(wp);

    if (keyNodeNames.length < 80) {
      keyNodeNames.push(isMesh ? `${rawName} [Mesh]` : rawName);
    }
    if (namedNodeCoords.length < 60) {
      namedNodeCoords.push({
        name: rawName,
        kind: isMesh ? 'Mesh' : 'Node',
        worldPosition: roundCoords(wp)
      });
    }

    const upper = rawName.toUpperCase();

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
    sceneBounds.min.set(-19, 0, -19);
    sceneBounds.max.set(19, 12, 19);
    sizeVec.set(38, 12, 38);
    centerVec.set(0, 6, 0);
  }

  const floorY = Number.isFinite(sceneBounds.min.y) ? sceneBounds.min.y : 0;
  const deckSurfaceY = sampleGroundDeckY(root, sceneBounds, allMeshes);
  const diag = Math.max(sizeVec.length(), 14);

  const resolveRelAnchor = (rel: readonly [number, number, number]): THREE.Vector3 => {
    const x = centerVec.x + rel[0] * sizeVec.x;
    const z = centerVec.z + rel[2] * sizeVec.z;
    const surfY = sampleSurfaceYAt(x, z, sceneBounds, allMeshes, deckSurfaceY);
    const y = surfY + rel[1] * sizeVec.y;
    return new THREE.Vector3(x, y, z);
  };

  // Точка обзора всего комплекса (для отладки и клавиши [K])
  const focusCameraTarget = new THREE.Vector3(
    centerVec.x,
    deckSurfaceY + Math.max(1.5, sizeVec.y * transform.spawn.lookAtHeightRatio),
    centerVec.z
  );
  const focusCameraPos = new THREE.Vector3(
    centerVec.x + sizeVec.x * 0.12,
    deckSurfaceY + Math.max(4.5, Math.min(48, diag * transform.spawn.overviewElevationFactor)),
    sceneBounds.max.z + Math.max(6.5, Math.min(75, diag * transform.spawn.overviewDistanceFactor * 0.55))
  );

  // Валидная стартовая точка игрока: либо узел SPAWN_PLAYER из .glb, либо перед южной границей Box3
  let spawnPlayer: THREE.Vector3;
  const spawnLookTarget = new THREE.Vector3(
    centerVec.x,
    deckSurfaceY + Math.max(1.5, Math.min(6.0, sizeVec.y * transform.spawn.lookAtHeightRatio)),
    centerVec.z
  );

  if (spawnCandidates.length > 0) {
    spawnPlayer = spawnCandidates[0].pos.clone();
  } else {
    const spawnX = centerVec.x + transform.spawn.lateralNormX * sizeVec.x;
    const spawnZ = sceneBounds.max.z + transform.spawn.forwardMarginMeters;
    spawnPlayer = new THREE.Vector3(spawnX, deckSurfaceY, spawnZ);
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
    const autoEntrance = resolveRelAnchor(config.defaultEntranceRelPos);
    missingExpectedNodes.push(`ENTRANCE_* (авто по Box3: [${roundCoords(autoEntrance).join(', ')}])`);
    entrances.push({ name: 'AUTO_ENTRANCE_MAIN', pos: autoEntrance });
  }

  if (exits.length === 0) {
    missingExpectedNodes.push('EXIT_* (авто-точки эваковыхода по Box3 модели)');
    config.defaultExits.forEach(ex => {
      exits.push({
        name: ex.id,
        pos: resolveRelAnchor(ex.relPos)
      });
    });
  }

  if (assemblyPoints.length === 0) {
    const autoAssembly = resolveRelAnchor(config.defaultAssemblyRelPos);
    missingExpectedNodes.push(`ASSEMBLY_* (авто по Box3: [${roundCoords(autoAssembly).join(', ')}])`);
    assemblyPoints.push({ name: 'AUTO_ASSEMBLY_MAIN', pos: autoAssembly });
  }

  if (extinguisherPoints.length === 0) {
    const off = config.defaultPrimaryExtinguisherRelOffset;
    const primaryPost = new THREE.Vector3(
      spawnPlayer.x + off[0],
      deckSurfaceY + off[1],
      spawnPlayer.z + off[2]
    );
    const sparePost = resolveRelAnchor(config.defaultSpareExtinguisherRelPos);
    missingExpectedNodes.push('EXTINGUISHER_POINT_* (размещены у старта и на проезде комплекса)');
    extinguisherPoints.push(
      { name: 'AUTO_EXTINGUISHER_1', pos: primaryPost },
      { name: 'AUTO_EXTINGUISHER_SPARE', pos: sparePost }
    );
  }

  // Привязка очагов пожара: сначала узлы из .glb, иначе относительные координаты Box3 + поверхность модели
  const resolvedFireZones: NamedWorldMarker[] = config.fireZones.map((fz, idx) => {
    const found =
      fireZones.find(m => m.name.toUpperCase().startsWith(fz.markerName.toUpperCase())) ??
      fireZones[idx];
    if (found) return found;
    const autoPos = resolveRelAnchor(fz.relPos);
    missingExpectedNodes.push(`${fz.markerName} (привязан к Box3: [${roundCoords(autoPos).join(', ')}])`);
    return { name: fz.markerName, pos: autoPos };
  });

  // Привязка групп NPC и их waypoint-маршрутов к модели
  const resolvedNpcSpawns: NamedWorldMarker[] = config.npcGroups.map((ng, idx) => {
    const found =
      npcSpawns.find(m => m.name.toUpperCase().startsWith(ng.markerName.toUpperCase())) ??
      npcSpawns[idx];
    if (found) return found;
    const autoPos = resolveRelAnchor(ng.relPos);
    missingExpectedNodes.push(`${ng.markerName} (привязан к Box3: [${roundCoords(autoPos).join(', ')}])`);
    return { name: ng.markerName, pos: autoPos };
  });

  const resolvedWaypoints: NamedWorldMarker[] = [...waypoints];
  config.npcGroups.forEach(ng => {
    const hasWp = waypoints.some(w => w.name.toUpperCase().startsWith(ng.waypointPrefix.toUpperCase()));
    if (!hasWp) {
      ng.relWaypoints.forEach((relWp, wpIdx) => {
        resolvedWaypoints.push({
          name: `${ng.waypointPrefix}0${wpIdx + 1}`,
          pos: resolveRelAnchor(relWp)
        });
      });
    }
  });

  const resolvedTriggers: NamedWorldMarker[] = config.triggerZones.map(tz => {
    const found = triggers.find(m => m.name.toUpperCase().startsWith(tz.markerName.toUpperCase()));
    if (found) return found;
    return {
      name: tz.markerName,
      pos: resolveRelAnchor(tz.relPos)
    };
  });

  const rawMin = normMetrics?.rawBoundingBoxMin ?? roundCoords(sceneBounds.min);
  const rawMax = normMetrics?.rawBoundingBoxMax ?? roundCoords(sceneBounds.max);
  const rawSize = normMetrics?.rawBoundingBoxSize ?? roundCoords(sizeVec);
  const appliedRotationDeg = normMetrics?.appliedRotationDeg ?? [0, 0, 0];
  const appliedScale = normMetrics?.appliedScale ?? 1.0;

  const report: NppInspectionReport = {
    sourceKind,
    sourceUrl,
    totalNodes,
    totalMeshes,
    rawBoundingBoxMin: rawMin,
    rawBoundingBoxMax: rawMax,
    rawBoundingBoxSize: rawSize,
    appliedRotationDeg,
    appliedScale,
    deckSurfaceY: Number(deckSurfaceY.toFixed(3)),
    boundingBoxMin: roundCoords(sceneBounds.min),
    boundingBoxMax: roundCoords(sceneBounds.max),
    boundingBoxCenter: roundCoords(centerVec),
    boundingBoxSize: roundCoords(sizeVec),
    keyNodeNames,
    namedNodeCoords,
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
      fireZones: resolvedFireZones,
      npcSpawns: resolvedNpcSpawns,
      waypoints: resolvedWaypoints,
      triggers: resolvedTriggers,
      pois,
      extinguisherPoints,
      wallColliders
    }
  };

  console.groupCollapsed(
    `[ALARA GLB Inspector] ${sourceUrl} | Узлов: ${totalNodes} | Мешей: ${totalMeshes} | Box3: ${report.rawBoundingBoxSize.join('×')} -> ${report.boundingBoxSize.join('×')} м`
  );
  console.info('Исходный Box3 (до нормализации):', { min: rawMin, max: rawMax, size: rawSize });
  console.info('Нормализация (SCENARIO_4_TRANSFORM):', {
    rotationDeg: appliedRotationDeg,
    scale: Number(appliedScale.toFixed(4)),
    floorY: Number(floorY.toFixed(3)),
    deckSurfaceY: report.deckSurfaceY
  });
  console.info('Итоговый Box3 (после нормализации):', {
    min: report.boundingBoxMin,
    max: report.boundingBoxMax,
    center: report.boundingBoxCenter,
    size: report.boundingBoxSize
  });
  console.info(`Именованные узлы (${namedNodeCoords.length} из ${totalNodes}) и их мировые координаты:`, namedNodeCoords);
  if (missingExpectedNodes.length > 0) {
    console.info('Авто-привязанные игровые зоны (по Box3 и поверхности .glb):', missingExpectedNodes);
  }
  console.groupEnd();

  return report;
}
