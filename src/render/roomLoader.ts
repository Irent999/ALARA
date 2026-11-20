/**
 * roomLoader.ts — загрузка готовой модели помещения (GLB из Blender / фотограмметрии)
 * вместо комнаты, собранной кодом из простых форм.
 *
 * Что делает:
 *  1. грузит GLB (в т.ч. сжатый Draco/Meshopt/KTX2);
 *  2. включает тени, анизотропию, исправляет цветовые пространства текстур;
 *  3. помечает статику (matrixAutoUpdate = false) — это заметно разгружает CPU на тысячах мешей;
 *  4. возвращает габариты комнаты — их нужно передать в configureSun() для карты теней.
 *
 * Запечённый свет: если в Blender вы запекли лайтмапы в материалы и экспортировали их в GLB
 * (через KHR_materials / отдельный UV-канал), three подхватит их как material.lightMap.
 * Если лайтмапы лежат отдельными файлами — используйте createPBRMaterial() из qualityRenderer.ts.
 */

import * as THREE from 'three';
import type { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { upgradeSceneMaterials, type UpgradeOptions } from './qualityRenderer';

export interface RoomModelOptions extends UpgradeOptions {
  url: string;
  parent: THREE.Object3D;
  position?: [number, number, number];
  rotationYDeg?: number;
  scale?: number;
  /** Для запечённого освещения: сила lightMap (по умолчанию 1) */
  lightMapIntensity?: number;
  /** Имена мешей, которые нужно вернуть отдельным списком (например, коллайдеры «COL_*») */
  pickByNameRegex?: RegExp;
}

export interface LoadedRoom {
  root: THREE.Object3D;
  bounds: THREE.Box3;
  picked: THREE.Object3D[];
  stats: { meshes: number; triangles: number; materials: number; textures: number };
}

export async function loadRoomModel(
  renderer: THREE.WebGLRenderer,
  loader: GLTFLoader,
  opts: RoomModelOptions
): Promise<LoadedRoom> {
  const gltf = await loader.loadAsync(opts.url);
  const root = gltf.scene;
  root.name = `room:${opts.url}`;

  if (opts.position) root.position.set(...opts.position);
  if (opts.rotationYDeg) root.rotation.y = THREE.MathUtils.degToRad(opts.rotationYDeg);
  if (opts.scale) root.scale.setScalar(opts.scale);

  upgradeSceneMaterials(root, renderer, opts);

  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const picked: THREE.Object3D[] = [];
  let meshes = 0;
  let triangles = 0;

  root.traverse(o => {
    // Статика: матрицы считаются один раз
    o.matrixAutoUpdate = false;
    o.updateMatrix();

    if (opts.pickByNameRegex?.test(o.name)) picked.push(o);

    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshes++;
    const idx = mesh.geometry.index;
    const pos = mesh.geometry.getAttribute('position');
    triangles += idx ? idx.count / 3 : pos ? pos.count / 3 : 0;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      materials.add(m);
      const std = m as THREE.MeshStandardMaterial;
      if (opts.lightMapIntensity !== undefined && std.lightMap) std.lightMapIntensity = opts.lightMapIntensity;
      for (const v of Object.values(m as unknown as Record<string, unknown>)) {
        if (v && (v as THREE.Texture).isTexture) textures.add(v as THREE.Texture);
      }
    }
  });

  opts.parent.add(root);
  root.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(root);

  // Диагностика бюджета: смотрите в консоли, сколько «весит» комната
  console.info(
    `[room] ${opts.url}: ${meshes} мешей, ${Math.round(triangles).toLocaleString('ru')} треугольников, ` +
      `${materials.size} материалов, ${textures.size} текстур`
  );

  return { root, bounds, picked, stats: { meshes, triangles, materials: materials.size, textures: textures.size } };
}
