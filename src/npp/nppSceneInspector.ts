/**
 * ALARA — Инспектор иерархии графа сцены АЭС (.glb) и анализатор объёмов зданий
 * Выполняет scene.traverse по нормализованной 3D-модели /assembly.glb,
 * вычисляет Box3 отдельных корпусов/зданий, регистрирует узлы,
 * размещает очаги возгорания и 4 группы NPC (10 чел.) ВНУТРИ объёмов зданий на уровне внутреннего пола.
 */

import * as THREE from 'three';
import { NppAssemblyConfig, SCENARIO_4_CONFIG, WallColliderBox } from './nppNodeConfig';

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

export interface BuildingVolumeInfo {
  readonly id: string;
  readonly name: string;
  readonly nodeNames: ReadonlyArray<string>;
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
  readonly center: readonly [number, number, number];
  readonly size: readonly [number, number, number];
  readonly interiorFloorY: number;
  readonly footprintArea: number;
  readonly discoverySource: 'mesh_clusters' | 'raycast_heightmap' | 'fallback_layout';
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
  readonly vehicleSpawn: NamedWorldMarker;
  readonly buildingDriveTargets: NamedWorldMarker[];
  readonly radReconPoint: NamedWorldMarker;
  readonly loopIsolationPoint: NamedWorldMarker;
  readonly casualtyTriagePoint: NamedWorldMarker;
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
  readonly buildingVolumes: ReadonlyArray<BuildingVolumeInfo>;
  readonly mainBuildings: ReadonlyArray<BuildingVolumeInfo>;
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

function roundNum(n: number): number {
  return Number(n.toFixed(2));
}

/**
 * Определяет высоту горизонтальной площадки/пола модели (.glb) с помощью нисходящих лучей
 * в пределах разумной высоты цоколя (чтобы не принимать крыши корпусов и градирен за уровень земли).
 */
function sampleGroundDeckY(bounds: THREE.Box3, meshes: THREE.Mesh[]): number {
  const minY = Number.isFinite(bounds.min.y) ? bounds.min.y : 0;
  if (bounds.isEmpty() || meshes.length === 0) return minY;

  const size = new THREE.Vector3();
  const center = new THREE.Vector3();
  bounds.getSize(size);
  bounds.getCenter(center);

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  const down = new THREE.Vector3(0, -1, 0);
  const maxDeckDelta = Math.max(1.2, Math.min(4.5, size.y * 0.2));

  const samples: number[] = [];
  const offsets = [-0.44, -0.28, -0.1, 0.1, 0.28, 0.44];
  for (let ix = 0; ix < offsets.length; ix++) {
    for (let iz = 0; iz < offsets.length; iz++) {
      origin.set(
        center.x + offsets[ix] * size.x,
        bounds.max.y + 3.0,
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

/**
 * Определяет высоту пола ВНУТРИ здания или на настиле площадки (игнорируя крыши зданий).
 */
function sampleInteriorFloorY(
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
  const maxFloorY = deckY + Math.max(1.2, Math.min(3.5, sizeY * 0.14));

  const raycaster = new THREE.Raycaster(
    new THREE.Vector3(x, bounds.max.y + 3.0, z),
    new THREE.Vector3(0, -1, 0)
  );
  // Raycaster возвращает попадания сверху вниз: пропускаем крыши (> maxFloorY) и берём верхнюю плоскость пола внутри здания
  const hits = raycaster.intersectObjects(meshes, false);
  for (let i = 0; i < hits.length; i++) {
    const hy = hits[i].point.y;
    if (hy >= bounds.min.y - 0.05 && hy <= maxFloorY) {
      return hy;
    }
  }
  return deckY;
}

interface RawMeshBoxEntry {
  readonly name: string;
  readonly box: THREE.Box3;
  readonly size: THREE.Vector3;
  readonly center: THREE.Vector3;
}

/**
 * Сканирует меши .glb и кластеризует их в объёмы отдельных зданий/корпусов АЭС.
 * Если модель объединена в один общий меш, автоматически переключается на высотную сетку Raycaster.
 */
function discoverBuildingVolumes(
  sceneBounds: THREE.Box3,
  sceneSize: THREE.Vector3,
  sceneCenter: THREE.Vector3,
  allMeshes: THREE.Mesh[],
  deckSurfaceY: number
): BuildingVolumeInfo[] {
  const minBuildingHeight = Math.max(3.5, sceneSize.y * 0.16);
  const minBuildingWidth = Math.max(4.5, Math.min(sceneSize.x, sceneSize.z) * 0.045);

  const candidates: RawMeshBoxEntry[] = [];
  const tmpBox = new THREE.Box3();

  for (let i = 0; i < allMeshes.length; i++) {
    const mesh = allMeshes[i];
    tmpBox.setFromObject(mesh);
    if (tmpBox.isEmpty()) continue;

    const mSize = new THREE.Vector3();
    const mCenter = new THREE.Vector3();
    tmpBox.getSize(mSize);
    tmpBox.getCenter(mCenter);

    // Исключаем несущую плиту основания комплекса
    const isGroundPlate =
      mSize.x > sceneSize.x * 0.52 &&
      mSize.z > sceneSize.z * 0.52 &&
      mSize.y < sceneSize.y * 0.32;
    if (isGroundPlate) continue;

    // Исключаем мелкий декор, заборы и тонкие опоры/мачты
    if (
      mSize.y < minBuildingHeight ||
      mSize.x < minBuildingWidth ||
      mSize.z < minBuildingWidth
    ) {
      continue;
    }

    const nodeName = mesh.name?.trim() || mesh.parent?.name?.trim() || `Mesh_${i + 1}`;
    candidates.push({
      name: nodeName,
      box: tmpBox.clone(),
      size: mSize,
      center: mCenter
    });
  }

  // Объединяем пересекающиеся/соседние части одного корпуса по горизонтальному перекрытию (допуск 2.5 м)
  const mergeGap = Math.max(1.8, Math.min(4.0, Math.max(sceneSize.x, sceneSize.z) * 0.02));
  const used = new Array<boolean>(candidates.length).fill(false);
  const clusters: Array<{ box: THREE.Box3; names: string[] }> = [];

  for (let i = 0; i < candidates.length; i++) {
    if (used[i]) continue;
    used[i] = true;
    const clusterBox = candidates[i].box.clone();
    const names = [candidates[i].name];

    let expanded = true;
    while (expanded) {
      expanded = false;
      for (let j = 0; j < candidates.length; j++) {
        if (used[j]) continue;
        const c = candidates[j].box;
        const overlapX =
          clusterBox.min.x - mergeGap <= c.max.x && clusterBox.max.x + mergeGap >= c.min.x;
        const overlapZ =
          clusterBox.min.z - mergeGap <= c.max.z && clusterBox.max.z + mergeGap >= c.min.z;
        if (overlapX && overlapZ) {
          clusterBox.union(c);
          if (names.length < 10 && !names.includes(candidates[j].name)) {
            names.push(candidates[j].name);
          }
          used[j] = true;
          expanded = true;
        }
      }
    }

    const cSize = new THREE.Vector3();
    clusterBox.getSize(cSize);
    const isWholeSiteEnvelope =
      cSize.x > sceneSize.x * 0.68 && cSize.z > sceneSize.z * 0.68;
    if (!isWholeSiteEnvelope && Math.min(cSize.x, cSize.z) >= minBuildingWidth) {
      clusters.push({ box: clusterBox, names });
    }
  }

  const volumes: BuildingVolumeInfo[] = clusters.map((cl, idx) => {
    const cSize = new THREE.Vector3();
    const cCenter = new THREE.Vector3();
    cl.box.getSize(cSize);
    cl.box.getCenter(cCenter);
    const floorY = sampleInteriorFloorY(cCenter.x, cCenter.z, sceneBounds, allMeshes, deckSurfaceY);
    return {
      id: `BUILDING_${idx + 1}`,
      name: cl.names[0] || `Корпус_${idx + 1}`,
      nodeNames: cl.names,
      min: [roundNum(cl.box.min.x), roundNum(cl.box.min.y), roundNum(cl.box.min.z)],
      max: [roundNum(cl.box.max.x), roundNum(cl.box.max.y), roundNum(cl.box.max.z)],
      center: [roundNum(cCenter.x), roundNum(cCenter.y), roundNum(cCenter.z)],
      size: [roundNum(cSize.x), roundNum(cSize.y), roundNum(cSize.z)],
      interiorFloorY: roundNum(floorY),
      footprintArea: roundNum(cSize.x * cSize.z),
      discoverySource: 'mesh_clusters'
    };
  });

  // Сортируем корпуса: сначала крупные объёмные здания (залы/энергоблоки), далее по X слева направо
  volumes.sort((a, b) => b.footprintArea - a.footprintArea);

  // Если меш был монолитным (обнаружено < 2 корпусов), сканируем высотную карту кровли Raycaster'ом
  if (volumes.length < 2 && allMeshes.length > 0 && !sceneBounds.isEmpty()) {
    const gridN = 11;
    const roofThreshold = deckSurfaceY + Math.max(3.5, sceneSize.y * 0.2);
    const isRoof: boolean[][] = Array.from({ length: gridN }, () =>
      new Array<boolean>(gridN).fill(false)
    );
    const cellHitY: number[][] = Array.from({ length: gridN }, () =>
      new Array<number>(gridN).fill(deckSurfaceY)
    );

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const stepX = (sceneSize.x * 0.88) / gridN;
    const stepZ = (sceneSize.z * 0.88) / gridN;
    const startX = sceneCenter.x - sceneSize.x * 0.44 + stepX * 0.5;
    const startZ = sceneCenter.z - sceneSize.z * 0.44 + stepZ * 0.5;

    for (let gx = 0; gx < gridN; gx++) {
      for (let gz = 0; gz < gridN; gz++) {
        const wx = startX + gx * stepX;
        const wz = startZ + gz * stepZ;
        raycaster.set(new THREE.Vector3(wx, sceneBounds.max.y + 3.0, wz), down);
        const hits = raycaster.intersectObjects(allMeshes, false);
        if (hits.length > 0 && hits[0].point.y >= roofThreshold) {
          isRoof[gx][gz] = true;
          cellHitY[gx][gz] = hits[0].point.y;
        }
      }
    }

    const visited: boolean[][] = Array.from({ length: gridN }, () =>
      new Array<boolean>(gridN).fill(false)
    );
    const heightmapVolumes: BuildingVolumeInfo[] = [];

    for (let gx = 0; gx < gridN; gx++) {
      for (let gz = 0; gz < gridN; gz++) {
        if (!isRoof[gx][gz] || visited[gx][gz]) continue;
        const queue: Array<[number, number]> = [[gx, gz]];
        visited[gx][gz] = true;
        let minGx = gx;
        let maxGx = gx;
        let minGz = gz;
        let maxGz = gz;
        let maxRoofY = cellHitY[gx][gz];
        let cells = 0;

        while (queue.length > 0) {
          const [cx, cz] = queue.shift()!;
          cells += 1;
          minGx = Math.min(minGx, cx);
          maxGx = Math.max(maxGx, cx);
          minGz = Math.min(minGz, cz);
          maxGz = Math.max(maxGz, cz);
          maxRoofY = Math.max(maxRoofY, cellHitY[cx][cz]);

          const dirs = [
            [1, 0],
            [-1, 0],
            [0, 1],
            [0, -1]
          ];
          for (const [dx, dz] of dirs) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (
              nx >= 0 &&
              nx < gridN &&
              nz >= 0 &&
              nz < gridN &&
              !visited[nx][nz] &&
              isRoof[nx][nz]
            ) {
              visited[nx][nz] = true;
              queue.push([nx, nz]);
            }
          }
        }

        if (cells < 1) continue;
        const bxMin = startX + minGx * stepX - stepX * 0.45;
        const bxMax = startX + maxGx * stepX + stepX * 0.45;
        const bzMin = startZ + minGz * stepZ - stepZ * 0.45;
        const bzMax = startZ + maxGz * stepZ + stepZ * 0.45;
        const bCx = (bxMin + bxMax) * 0.5;
        const bCz = (bzMin + bzMax) * 0.5;
        const bSx = bxMax - bxMin;
        const bSz = bzMax - bzMin;
        const bSy = maxRoofY - deckSurfaceY;
        const floorY = sampleInteriorFloorY(bCx, bCz, sceneBounds, allMeshes, deckSurfaceY);

        heightmapVolumes.push({
          id: `ROOF_ZONE_${heightmapVolumes.length + 1}`,
          name: `Корпус_${heightmapVolumes.length + 1} (высотная карта)`,
          nodeNames: ['MergedMesh_RoofCluster'],
          min: [roundNum(bxMin), roundNum(floorY), roundNum(bzMin)],
          max: [roundNum(bxMax), roundNum(maxRoofY), roundNum(bzMax)],
          center: [roundNum(bCx), roundNum((floorY + maxRoofY) * 0.5), roundNum(bCz)],
          size: [roundNum(bSx), roundNum(bSy), roundNum(bSz)],
          interiorFloorY: roundNum(floorY),
          footprintArea: roundNum(bSx * bSz),
          discoverySource: 'raycast_heightmap'
        });
      }
    }

    heightmapVolumes.sort((a, b) => b.footprintArea - a.footprintArea);
    if (heightmapVolumes.length >= 2) {
      return heightmapVolumes.slice(0, 8);
    }
  }

  if (volumes.length > 0) {
    return volumes.slice(0, 8);
  }

  // Аварийный геометрический резерв, если модель плоская без выраженных корпусов
  const sectors: ReadonlyArray<{ name: string; rel: readonly [number, number]; sz: readonly [number, number] }> = [
    { name: 'Западный корпус (Блок №1)', rel: [-0.16, 0.10], sz: [0.24, 0.26] },
    { name: 'Восточный корпус (Блок №2)', rel: [0.20, 0.08], sz: [0.24, 0.26] },
    { name: 'Вспомогательный корпус', rel: [-0.28, -0.06], sz: [0.18, 0.24] }
  ];
  return sectors.map((sec, idx) => {
    const cx = sceneCenter.x + sec.rel[0] * sceneSize.x;
    const cz = sceneCenter.z + sec.rel[1] * sceneSize.z;
    const sx = sec.sz[0] * sceneSize.x;
    const sz = sec.sz[1] * sceneSize.z;
    const sy = Math.max(12, sceneSize.y * 0.65);
    const floorY = sampleInteriorFloorY(cx, cz, sceneBounds, allMeshes, deckSurfaceY);
    return {
      id: `SECTOR_${idx + 1}`,
      name: sec.name,
      nodeNames: [sec.name],
      min: [roundNum(cx - sx * 0.5), roundNum(floorY), roundNum(cz - sz * 0.5)],
      max: [roundNum(cx + sx * 0.5), roundNum(floorY + sy), roundNum(cz + sz * 0.5)],
      center: [roundNum(cx), roundNum(floorY + sy * 0.5), roundNum(cz)],
      size: [roundNum(sx), roundNum(sy), roundNum(sz)],
      interiorFloorY: roundNum(floorY),
      footprintArea: roundNum(sx * sz),
      discoverySource: 'fallback_layout'
    };
  });
}

const CLEARANCE_DIRS: ReadonlyArray<THREE.Vector3> = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1),
  new THREE.Vector3(0.707, 0, 0.707),
  new THREE.Vector3(-0.707, 0, 0.707),
  new THREE.Vector3(0.707, 0, -0.707),
  new THREE.Vector3(-0.707, 0, -0.707)
];

/**
 * Оценивает минимальный горизонтальный зазор от точки до вертикальных стен/колонн .glb.
 * Если лучи на уровне груди/пояса упираются в стену ближе minClearanceM, точка считается заблокированной.
 */
function measureWallClearance(
  x: number,
  floorY: number,
  z: number,
  meshes: THREE.Mesh[],
  maxRangeM: number
): number {
  if (meshes.length === 0) return maxRangeM;

  const raycaster = new THREE.Raycaster();
  const origin = new THREE.Vector3();
  let minClearance = maxRangeM;
  const heights = [floorY + 0.75, floorY + 1.45];

  for (let hi = 0; hi < heights.length; hi++) {
    origin.set(x, heights[hi], z);
    for (let di = 0; di < CLEARANCE_DIRS.length; di++) {
      raycaster.set(origin, CLEARANCE_DIRS[di]);
      raycaster.near = 0.05;
      raycaster.far = maxRangeM;
      const hits = raycaster.intersectObjects(meshes, false);
      for (let k = 0; k < hits.length; k++) {
        const hit = hits[k];
        // Игнорируем пологие настилы пола
        if (hit.face && Math.abs(hit.face.normal.y) > 0.78 && hit.distance > 0.6) {
          continue;
        }
        if (hit.distance < minClearance) {
          minClearance = hit.distance;
        }
        break;
      }
    }
  }
  return minClearance;
}

/**
 * Ищет ближайшую открытую, проходимую точку внутри корпуса с учётом зазора до стен .glb и уже занятых точек.
 */
function findClearIndoorSpot(
  building: BuildingVolumeInfo,
  offsetXZ: readonly [number, number],
  sceneBounds: THREE.Box3,
  allMeshes: THREE.Mesh[],
  deckSurfaceY: number,
  occupiedSpots: ReadonlyArray<THREE.Vector3> = [],
  minSpacingM = 2.4
): THREE.Vector3 {
  const wallMarginX = Math.min(2.3, building.size[0] * 0.16);
  const wallMarginZ = Math.min(2.3, building.size[2] * 0.16);
  const clampedOx = THREE.MathUtils.clamp(offsetXZ[0], -0.34, 0.34);
  const clampedOz = THREE.MathUtils.clamp(offsetXZ[1], -0.34, 0.34);

  const baseRawX = building.center[0] + clampedOx * building.size[0];
  const baseRawZ = building.center[2] + clampedOz * building.size[2];

  const minX = building.min[0] + wallMarginX;
  const maxX = building.max[0] - wallMarginX;
  const minZ = building.min[2] + wallMarginZ;
  const maxZ = building.max[2] - wallMarginZ;

  const anchorX = minX <= maxX ? THREE.MathUtils.clamp(baseRawX, minX, maxX) : building.center[0];
  const anchorZ = minZ <= maxZ ? THREE.MathUtils.clamp(baseRawZ, minZ, maxZ) : building.center[2];

  const minWallClear = SCENARIO_4_CONFIG.FIRE_CLEARANCE.minWallClearanceM;
  const stepM = SCENARIO_4_CONFIG.FIRE_CLEARANCE.searchRadiusStepM;
  const maxRings = SCENARIO_4_CONFIG.FIRE_CLEARANCE.maxSearchRings;

  let bestPos = new THREE.Vector3(
    anchorX,
    sampleInteriorFloorY(anchorX, anchorZ, sceneBounds, allMeshes, deckSurfaceY),
    anchorZ
  );
  let bestScore = -Infinity;

  for (let ring = 0; ring <= maxRings; ring++) {
    const angles = ring === 0 ? 1 : 8;
    for (let ai = 0; ai < angles; ai++) {
      const ang = (ai / angles) * Math.PI * 2;
      const cx =
        ring === 0
          ? anchorX
          : THREE.MathUtils.clamp(anchorX + Math.cos(ang) * ring * stepM, Math.min(minX, maxX), Math.max(minX, maxX));
      const cz =
        ring === 0
          ? anchorZ
          : THREE.MathUtils.clamp(anchorZ + Math.sin(ang) * ring * stepM, Math.min(minZ, maxZ), Math.max(minZ, maxZ));

      const fy = sampleInteriorFloorY(cx, cz, sceneBounds, allMeshes, deckSurfaceY);
      const wallClear = measureWallClearance(cx, fy, cz, allMeshes, minWallClear + 0.8);

      let tooClosePenalty = 0;
      for (let oi = 0; oi < occupiedSpots.length; oi++) {
        const d = Math.hypot(cx - occupiedSpots[oi].x, cz - occupiedSpots[oi].z);
        if (d < minSpacingM) {
          tooClosePenalty += (minSpacingM - d) * 6.0;
        }
      }

      const distFromAnchor = Math.hypot(cx - anchorX, cz - anchorZ);
      const score = Math.min(wallClear, minWallClear) * 4.5 - distFromAnchor * 0.25 - tooClosePenalty;
      if (score > bestScore) {
        bestScore = score;
        bestPos = new THREE.Vector3(cx, fy, cz);
      }

      if (wallClear >= minWallClear * 0.85 && tooClosePenalty === 0) {
        return bestPos;
      }
    }
  }

  return bestPos;
}

/**
 * Вычисляет гарантированно внутреннюю точку внутри Box3 корпуса с отступом от наружных стен.
 */
function resolveInsideBuilding(
  building: BuildingVolumeInfo,
  offsetXZ: readonly [number, number],
  sceneBounds: THREE.Box3,
  allMeshes: THREE.Mesh[],
  deckSurfaceY: number
): THREE.Vector3 {
  return findClearIndoorSpot(building, offsetXZ, sceneBounds, allMeshes, deckSurfaceY);
}

/**
 * Выбирает наиболее подходящие корпуса для привязки (предпочитая крупные корпуса ближе к южной/центральной части АЭС).
 */
function selectMainPlantBuildings(volumes: BuildingVolumeInfo[]): BuildingVolumeInfo[] {
  if (volumes.length <= 1) return volumes;
  // Отбираем корпуса с заметным объёмом (не тонкие башни/эстакады)
  const halls = volumes.filter(v => Math.min(v.size[0], v.size[2]) >= 6.0);
  const pool = halls.length >= 2 ? halls : volumes;
  // Берём топ-4 крупнейших корпуса и сортируем по близости к передней (+Z) половине и слева направо
  const top = pool.slice(0, 4);
  return [...top].sort((a, b) => {
    const scoreA = a.center[2] - a.center[0] * 0.25;
    const scoreB = b.center[2] - b.center[0] * 0.25;
    return scoreB - scoreA;
  });
}

/**
 * Проводит полный обход графа нормализованной сцены (.glb), анализирует объёмы зданий,
 * вычисляет габариты Box3, высоту пола внутри зданий и привязывает все очаги и 4 группы NPC внутрь корпусов.
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

  waypoints.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

  sceneBounds.setFromObject(root);
  if (!sceneBounds.isEmpty()) {
    sceneBounds.getSize(sizeVec);
    sceneBounds.getCenter(centerVec);
  } else {
    sceneBounds.min.set(-82, 0, -82);
    sceneBounds.max.set(82, 32, 82);
    sizeVec.set(164, 32, 164);
    centerVec.set(0, 16, 0);
  }

  const floorY = Number.isFinite(sceneBounds.min.y) ? sceneBounds.min.y : 0;
  const deckSurfaceY = sampleGroundDeckY(sceneBounds, allMeshes);
  const diag = Math.max(sizeVec.length(), 30);

  // Анализируем объёмы всех корпусов/зданий комплекса
  const allBuildingVolumes = discoverBuildingVolumes(
    sceneBounds,
    sizeVec,
    centerVec,
    allMeshes,
    deckSurfaceY
  );
  const mainBuildings = selectMainPlantBuildings(allBuildingVolumes);
  const primaryBuilding = mainBuildings[0];

  const resolveRelAnchor = (rel: readonly [number, number, number]): THREE.Vector3 => {
    const x = centerVec.x + rel[0] * sizeVec.x;
    const z = centerVec.z + rel[2] * sizeVec.z;
    const surfY = sampleInteriorFloorY(x, z, sceneBounds, allMeshes, deckSurfaceY);
    return new THREE.Vector3(x, surfY + rel[1] * sizeVec.y, z);
  };

  // Точка обзора всего комплекса (клавиша [K])
  const focusCameraTarget = new THREE.Vector3(
    centerVec.x,
    deckSurfaceY + Math.max(3.0, sizeVec.y * transform.spawn.lookAtHeightRatio),
    centerVec.z
  );
  const focusCameraPos = new THREE.Vector3(
    centerVec.x + sizeVec.x * 0.12,
    deckSurfaceY + Math.max(12.0, Math.min(85, diag * transform.spawn.overviewElevationFactor)),
    sceneBounds.max.z + Math.max(14.0, Math.min(130, diag * transform.spawn.overviewDistanceFactor * 0.48))
  );

  // Вход в главный корпус (у переднего фасада первого здания, чтобы игрок заходил внутрь)
  if (entrances.length === 0) {
    const autoEntrance = primaryBuilding
      ? new THREE.Vector3(
          primaryBuilding.center[0],
          sampleInteriorFloorY(
            primaryBuilding.center[0],
            Math.min(sceneBounds.max.z - 2.0, primaryBuilding.max[2] + 1.5),
            sceneBounds,
            allMeshes,
            deckSurfaceY
          ),
          Math.min(sceneBounds.max.z - 2.0, primaryBuilding.max[2] + 1.5)
        )
      : resolveRelAnchor(config.defaultEntranceRelPos);
    missingExpectedNodes.push(`ENTRANCE_* (вход у фасада ${primaryBuilding?.name ?? 'главного корпуса'}: [${roundCoords(autoEntrance).join(', ')}])`);
    entrances.push({ name: 'AUTO_ENTRANCE_MAIN', pos: autoEntrance });
  }
  const mainEntrancePos = entrances[0].pos;

  // Стартовая позиция игрока: снаружи перед входом в главный корпус, лицом к зданиям
  let spawnPlayer: THREE.Vector3;
  const spawnLookTarget = new THREE.Vector3(
    primaryBuilding ? primaryBuilding.center[0] : centerVec.x,
    deckSurfaceY + Math.max(2.0, sizeVec.y * transform.spawn.lookAtHeightRatio),
    primaryBuilding ? primaryBuilding.center[2] : centerVec.z
  );

  if (spawnCandidates.length > 0) {
    spawnPlayer = spawnCandidates[0].pos.clone();
  } else {
    const spawnX = mainEntrancePos.x + transform.spawn.lateralNormX * sizeVec.x;
    const spawnZ = Math.max(
      sceneBounds.max.z + transform.spawn.forwardMarginMeters,
      mainEntrancePos.z + 11.0
    );
    const spawnY = sampleInteriorFloorY(
      THREE.MathUtils.clamp(spawnX, sceneBounds.min.x + 1, sceneBounds.max.x - 1),
      THREE.MathUtils.clamp(spawnZ, sceneBounds.min.z + 1, sceneBounds.max.z - 1),
      sceneBounds,
      allMeshes,
      deckSurfaceY
    );
    spawnPlayer = new THREE.Vector3(spawnX, spawnY, spawnZ);
    missingExpectedNodes.push(
      `SPAWN_PLAYER (снаружи перед входом: [${roundCoords(spawnPlayer).join(', ')}])`
    );
    discoveredNodes.push({
      category: 'playerSpawn',
      nodeName: 'AUTO_BOX3_SPAWN_PLAYER',
      worldPosition: roundCoords(spawnPlayer),
      usedFallback: true
    });
  }

  // Выходы и безопасный Пункт сбора снаружи (на передней площади перед корпусом)
  if (exits.length === 0) {
    missingExpectedNodes.push('EXIT_* (эваковыходы у корпусов)');
    const mainExitPos = new THREE.Vector3(
      mainEntrancePos.x + 3.2,
      mainEntrancePos.y,
      mainEntrancePos.z + 2.8
    );
    exits.push({ name: 'EXIT_MAIN', pos: mainExitPos });
    if (mainBuildings[1]) {
      const b2 = mainBuildings[1];
      const eastExitZ = Math.min(sceneBounds.max.z - 2.0, b2.max[2] + 1.8);
      exits.push({
        name: 'EXIT_EAST',
        pos: new THREE.Vector3(
          b2.center[0],
          sampleInteriorFloorY(b2.center[0], eastExitZ, sceneBounds, allMeshes, deckSurfaceY),
          eastExitZ
        )
      });
    } else {
      exits.push({ name: 'EXIT_EAST', pos: resolveRelAnchor(config.defaultExits[1].relPos) });
    }
  }

  if (assemblyPoints.length === 0) {
    const asmX = THREE.MathUtils.clamp(
      spawnPlayer.x + 10.5,
      sceneBounds.min.x + 4.0,
      sceneBounds.max.x - 4.0
    );
    const asmZ = Math.min(sceneBounds.max.z - 1.5, spawnPlayer.z - 3.0);
    const asmY = sampleInteriorFloorY(asmX, asmZ, sceneBounds, allMeshes, deckSurfaceY);
    const autoAssembly = new THREE.Vector3(asmX, asmY, asmZ);
    missingExpectedNodes.push(`ASSEMBLY_* (площадь сбора МЧС: [${roundCoords(autoAssembly).join(', ')}])`);
    assemblyPoints.push({ name: 'AUTO_ASSEMBLY_MAIN', pos: autoAssembly });
  }

  // Основной пост ОУ-5 — рядом со стартом перед входом, запасной — внутри главного корпуса
  if (extinguisherPoints.length === 0) {
    const primaryX = spawnPlayer.x - 2.5;
    const primaryZ = spawnPlayer.z - 3.6;
    const primaryY = sampleInteriorFloorY(
      THREE.MathUtils.clamp(primaryX, sceneBounds.min.x + 1, sceneBounds.max.x - 1),
      THREE.MathUtils.clamp(primaryZ, sceneBounds.min.z + 1, sceneBounds.max.z - 1),
      sceneBounds,
      allMeshes,
      deckSurfaceY
    );
    const primaryPost = new THREE.Vector3(primaryX, primaryY, primaryZ);

    const sparePost = primaryBuilding
      ? resolveInsideBuilding(
          primaryBuilding,
          [0.05, 0.24],
          sceneBounds,
          allMeshes,
          deckSurfaceY
        )
      : resolveRelAnchor(config.defaultSpareExtinguisherRelPos);

    missingExpectedNodes.push('EXTINGUISHER_POINT_* (основной ОУ-5 на старте, запасной внутри корпуса)');
    extinguisherPoints.push(
      { name: 'AUTO_EXTINGUISHER_1', pos: primaryPost },
      { name: 'AUTO_EXTINGUISHER_SPARE', pos: sparePost }
    );
  }

  // 1. Привязка очагов пожара строго ВНУТРИ открытых проходов зданий (без клиппинга в стенах .glb)
  const occupiedIndoorSpots: THREE.Vector3[] = [];
  const elevOffset = SCENARIO_4_CONFIG.FIRE_CLEARANCE.fireElevationOffsetM;

  const resolvedFireZones: NamedWorldMarker[] = config.fireZones.map((fz, idx) => {
    const found =
      fireZones.find(m => m.name.toUpperCase().startsWith(fz.markerName.toUpperCase())) ??
      fireZones[idx];
    if (found) {
      const p = found.pos.clone();
      p.y += elevOffset;
      occupiedIndoorSpots.push(p);
      return { name: found.name, pos: p };
    }

    const targetBld =
      mainBuildings.length > 0
        ? mainBuildings[fz.preferredBuildingIndex % mainBuildings.length]
        : undefined;
    const indoorPos = targetBld
      ? findClearIndoorSpot(
          targetBld,
          fz.buildingOffsetXZ,
          sceneBounds,
          allMeshes,
          deckSurfaceY,
          occupiedIndoorSpots,
          3.2
        )
      : resolveRelAnchor(fz.relPos);
    indoorPos.y += elevOffset;
    occupiedIndoorSpots.push(indoorPos);

    missingExpectedNodes.push(
      `${fz.markerName} -> ВНУТРИ "${targetBld?.name ?? 'комплекса'}" [${roundCoords(indoorPos).join(', ')}]`
    );
    return { name: fz.markerName, pos: indoorPos };
  });

  // 2. Привязка всех 4 групп NPC (10 чел.) строго ВНУТРИ зданий + маршруты выхода через входную дверь
  const resolvedNpcSpawns: NamedWorldMarker[] = config.npcGroups.map((ng, idx) => {
    const found =
      npcSpawns.find(m => m.name.toUpperCase().startsWith(ng.markerName.toUpperCase())) ??
      npcSpawns[idx];
    if (found) {
      occupiedIndoorSpots.push(found.pos);
      return found;
    }

    const targetBld =
      mainBuildings.length > 0
        ? mainBuildings[ng.preferredBuildingIndex % mainBuildings.length]
        : undefined;
    const indoorPos = targetBld
      ? findClearIndoorSpot(
          targetBld,
          ng.buildingOffsetXZ,
          sceneBounds,
          allMeshes,
          deckSurfaceY,
          occupiedIndoorSpots,
          3.0
        )
      : resolveRelAnchor(ng.relPos);
    occupiedIndoorSpots.push(indoorPos);

    missingExpectedNodes.push(
      `${ng.markerName} (${ng.count} чел.) -> ВНУТРИ "${targetBld?.name ?? 'комплекса'}" [${roundCoords(indoorPos).join(', ')}]`
    );
    return { name: ng.markerName, pos: indoorPos };
  });

  // 3. Дополнительные точки операций МЧС (доразведка на входе, задвижка контура, пострадавший)
  const radReconPos = new THREE.Vector3(
    THREE.MathUtils.lerp(spawnPlayer.x, mainEntrancePos.x, 0.55),
    mainEntrancePos.y,
    THREE.MathUtils.lerp(spawnPlayer.z, mainEntrancePos.z, 0.55)
  );
  const radReconPoint: NamedWorldMarker = {
    name: 'EMERGENCY_RAD_RECON',
    pos: radReconPos
  };

  const bldForIsolation = mainBuildings[0];
  const loopIsolationPos = bldForIsolation
    ? findClearIndoorSpot(
        bldForIsolation,
        [-0.22, -0.14],
        sceneBounds,
        allMeshes,
        deckSurfaceY,
        occupiedIndoorSpots,
        2.8
      )
    : resolveInsideBuilding(
        allBuildingVolumes[0],
        [-0.18, 0.0],
        sceneBounds,
        allMeshes,
        deckSurfaceY
      );
  occupiedIndoorSpots.push(loopIsolationPos);
  const loopIsolationPoint: NamedWorldMarker = {
    name: 'EMERGENCY_LOOP_ISOLATION',
    pos: loopIsolationPos
  };

  const bldForTriage = mainBuildings[1] ?? mainBuildings[0];
  const casualtyTriagePos = bldForTriage
    ? findClearIndoorSpot(
        bldForTriage,
        [-0.16, 0.16],
        sceneBounds,
        allMeshes,
        deckSurfaceY,
        occupiedIndoorSpots,
        2.8
      )
    : resolveInsideBuilding(
        allBuildingVolumes[0],
        [0.16, 0.14],
        sceneBounds,
        allMeshes,
        deckSurfaceY
      );
  occupiedIndoorSpots.push(casualtyTriagePos);
  const casualtyTriagePoint: NamedWorldMarker = {
    name: 'EMERGENCY_CASUALTY_TRIAGE',
    pos: casualtyTriagePos
  };

  // 4. Пожарный автомобиль МЧС на подъездной площадке и точки подъезда у каждого корпуса
  const vehOff = SCENARIO_4_CONFIG.VEHICLE.spawnOffsetFromPlayer;
  const vehX = THREE.MathUtils.clamp(
    spawnPlayer.x + vehOff[0],
    sceneBounds.min.x - 16,
    sceneBounds.max.x + 16
  );
  const vehZ = THREE.MathUtils.clamp(
    spawnPlayer.z + vehOff[2],
    sceneBounds.min.z - 16,
    sceneBounds.max.z + 20
  );
  const vehY = sampleInteriorFloorY(
    THREE.MathUtils.clamp(vehX, sceneBounds.min.x + 1, sceneBounds.max.x - 1),
    THREE.MathUtils.clamp(vehZ, sceneBounds.min.z + 1, sceneBounds.max.z - 1),
    sceneBounds,
    allMeshes,
    deckSurfaceY
  );
  const vehicleSpawn: NamedWorldMarker = {
    name: 'MCHS_VEHICLE_SPAWN',
    pos: new THREE.Vector3(vehX, vehY, vehZ)
  };

  const drivePool = mainBuildings.length > 0 ? mainBuildings : allBuildingVolumes.slice(0, 3);
  const buildingDriveTargets: NamedWorldMarker[] = drivePool.map((bld, idx) => {
    const driveZ = Math.min(sceneBounds.max.z + 10, bld.max[2] + 6.5);
    const driveX = THREE.MathUtils.clamp(bld.center[0], sceneBounds.min.x - 10, sceneBounds.max.x + 10);
    const driveY = sampleInteriorFloorY(
      THREE.MathUtils.clamp(driveX, sceneBounds.min.x + 1, sceneBounds.max.x - 1),
      THREE.MathUtils.clamp(driveZ, sceneBounds.min.z + 1, sceneBounds.max.z - 1),
      sceneBounds,
      allMeshes,
      deckSurfaceY
    );
    return {
      name: `Корпус №${idx + 1} (${bld.name})`,
      pos: new THREE.Vector3(driveX, driveY, driveZ)
    };
  });

  const resolvedWaypoints: NamedWorldMarker[] = [...waypoints];
  config.npcGroups.forEach((ng, idx) => {
    const hasWp = waypoints.some(w =>
      w.name.toUpperCase().startsWith(ng.waypointPrefix.toUpperCase())
    );
    if (!hasWp) {
      const npcStart = resolvedNpcSpawns[idx]?.pos ?? resolveRelAnchor(ng.relPos);
      const bld =
        mainBuildings.length > 0
          ? mainBuildings[ng.preferredBuildingIndex % mainBuildings.length]
          : undefined;
      const bldDoorZ = bld
        ? Math.min(sceneBounds.max.z - 2.0, bld.max[2] + 1.5)
        : mainEntrancePos.z;
      const bldDoorX = bld ? bld.center[0] : mainEntrancePos.x;
      const doorFloorY = sampleInteriorFloorY(
        bldDoorX,
        bldDoorZ,
        sceneBounds,
        allMeshes,
        deckSurfaceY
      );
      const midInteriorPos = new THREE.Vector3(
        THREE.MathUtils.lerp(npcStart.x, bldDoorX, 0.5),
        npcStart.y,
        THREE.MathUtils.lerp(npcStart.z, bldDoorZ, 0.5)
      );
      const doorwayPos = new THREE.Vector3(bldDoorX, doorFloorY, bldDoorZ);
      const courtyardPos = exits[0].pos.clone();

      resolvedWaypoints.push(
        { name: `${ng.waypointPrefix}01`, pos: midInteriorPos },
        { name: `${ng.waypointPrefix}02`, pos: doorwayPos },
        { name: `${ng.waypointPrefix}03`, pos: courtyardPos }
      );
    }
  });

  const resolvedTriggers: NamedWorldMarker[] = config.triggerZones.map(tz => {
    const found = triggers.find(m => m.name.toUpperCase().startsWith(tz.markerName.toUpperCase()));
    if (found) return found;
    if (tz.kind === 'entry') {
      return { name: tz.markerName, pos: mainEntrancePos.clone() };
    }
    if (tz.kind === 'assembly') {
      return { name: tz.markerName, pos: assemblyPoints[0].pos.clone() };
    }
    return {
      name: tz.markerName,
      pos: exits[1]?.pos.clone() ?? resolveRelAnchor(tz.relPos)
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
    buildingVolumes: allBuildingVolumes,
    mainBuildings,
    keyNodeNames,
    namedNodeCoords,
    discoveredNodes,
    missingExpectedNodes,
    markers: {
      spawnPlayer,
      spawnLookTarget,
      focusCameraPos,
      focusCameraTarget,
      vehicleSpawn,
      buildingDriveTargets,
      radReconPoint,
      loopIsolationPoint,
      casualtyTriagePoint,
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
    `[ALARA GLB Inspector] ${sourceUrl} | Корпусов: ${allBuildingVolumes.length} | Узлов: ${totalNodes} | Box3: ${report.rawBoundingBoxSize.join('×')} -> ${report.boundingBoxSize.join('×')} м`
  );
  console.info('Исходный Box3 (до нормализации):', { min: rawMin, max: rawMax, size: rawSize });
  console.info('Нормализация (SCENARIO_4_CONFIG):', {
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
  console.info('Обнаруженные корпуса / объёмы зданий АЭС:', allBuildingVolumes);
  console.info(`Именованные узлы (${namedNodeCoords.length} из ${totalNodes}) и мировые координаты:`, namedNodeCoords);
  if (missingExpectedNodes.length > 0) {
    console.info('Внутренние точки очагов/NPC (внутри зданий .glb):', missingExpectedNodes);
  }
  console.groupEnd();

  return report;
}
