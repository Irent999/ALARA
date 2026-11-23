/**
 * ALARA — Загрузчик оригинальной 3D-модели АЭС (/assembly.glb) через GLTFLoader
 * с поддержкой Draco + Meshopt компрессии, потоковым скачиванием с AbortSignal,
 * неблокирующей поэтапной нормализацией мешей/материалов и таймингом этапов.
 *
 * ВАЖНО: Никакой подмены процедурной комнатой/примитивами!
 * При ошибке загрузки возвращается явная ошибка в консоль и HUD.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { NPP_NODE_CONFIG, NppAssemblyConfig } from './nppNodeConfig';
import {
  inspectNppSceneGraphAsync,
  NppInspectionReport,
  NppSceneSourceKind,
  throwIfAborted,
  yieldToBrowser
} from './nppSceneInspector';

export interface NppLoadResult {
  readonly sceneRoot: THREE.Group;
  readonly report: NppInspectionReport;
  readonly resolvedUrl: string;
}

export interface NppLoadCallbacks {
  readonly signal?: AbortSignal;
  readonly onProgress?: (progressPct: number, statusTextRu: string) => void;
}

/**
 * Безопасно освобождает все геометрии, материалы и текстуры иерархии GLB без двойного dispose.
 */
export function disposeGlbSceneHierarchy(tree: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();

  tree.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (mesh.isMesh || (obj as THREE.InstancedMesh).isInstancedMesh || (obj as THREE.Points).isPoints) {
      if (mesh.geometry) {
        geometries.add(mesh.geometry);
      }
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let i = 0; i < mats.length; i++) {
        const m = mats[i];
        if (!m) continue;
        materials.add(m);
        const std = m as THREE.MeshStandardMaterial;
        if (std.map) textures.add(std.map);
        if (std.normalMap) textures.add(std.normalMap);
        if (std.roughnessMap) textures.add(std.roughnessMap);
        if (std.metalnessMap) textures.add(std.metalnessMap);
        if (std.emissiveMap) textures.add(std.emissiveMap);
        if (std.aoMap) textures.add(std.aoMap);
        if (std.alphaMap) textures.add(std.alphaMap);
      }
    }
  });

  textures.forEach(tex => tex.dispose());
  materials.forEach(mat => mat.dispose());
  geometries.forEach(geo => geo.dispose());
}

export class NppAssemblyLoader {
  private readonly config: NppAssemblyConfig;
  private dracoLoader: DRACOLoader | null = null;
  private gltfLoader: GLTFLoader | null = null;

  constructor(config: NppAssemblyConfig = NPP_NODE_CONFIG) {
    this.config = config;
    this.dracoLoader = new DRACOLoader();
    this.dracoLoader.setDecoderPath(this.config.dracoDecoderPath);
    this.gltfLoader = new GLTFLoader();
    this.gltfLoader.setDRACOLoader(this.dracoLoader);
    this.gltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }

  public getConfig(): NppAssemblyConfig {
    return this.config;
  }

  private buildCandidateUrls(customUrl?: string): string[] {
    if (customUrl) return [customUrl];

    const rawBase = import.meta.env?.BASE_URL ?? '/';
    const normalizedBase = rawBase.endsWith('/') ? rawBase : `${rawBase}/`;
    const candidates = [
      this.config.glbUrl,
      `${normalizedBase}assembly.glb`,
      '/assembly.glb'
    ];
    return Array.from(new Set(candidates.filter(Boolean)));
  }

  private async diagnoseNetworkUrl(url: string, signal?: AbortSignal): Promise<string | null> {
    if (url.startsWith('blob:') || url.startsWith('data:')) return null;
    try {
      const res = await fetch(url, { method: 'HEAD', signal });
      const ct = res.headers.get('content-type') ?? 'unknown';
      if (!res.ok) {
        return `HTTP ${res.status} (${res.statusText || 'Not Found'}) по адресу "${url}"`;
      }
      if (ct.toLowerCase().includes('text/html')) {
        return `Сервер вернул HTML-страницу (SPA fallback, content-type: ${ct}) вместо бинарного .glb — проверьте наличие файла public/assembly.glb`;
      }
      return null;
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError' || signal?.aborted) {
        throw err;
      }
      return null;
    }
  }

  private async fetchBinaryWithProgress(
    url: string,
    callbacks?: NppLoadCallbacks
  ): Promise<ArrayBuffer> {
    throwIfAborted(callbacks?.signal);
    console.info(`[ALARA GLB] Старт загрузки: "${url}" (Draco: "${this.config.dracoDecoderPath}")`);
    console.time('[ALARA GLB] 1. Скачивание .glb');
    callbacks?.onProgress?.(5, `Подключение к ${url}...`);

    const response = await fetch(url, { signal: callbacks?.signal });
    if (!response.ok) {
      console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
      throw new Error(`HTTP ${response.status} (${response.statusText || 'Error'}) по адресу "${url}"`);
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) {
      console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
      throw new Error(
        `По пути "${url}" получен HTML (${contentType}) вместо бинарного .glb (проверьте public/assembly.glb)`
      );
    }

    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;

    let arrayBuffer: ArrayBuffer;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loadedBytes = 0;
      let lastLoggedBucket = -1;
      let lastUiUpdateMs = 0;

      try {
        while (true) {
          throwIfAborted(callbacks?.signal);
          const { done, value } = await reader.read();
          if (done) break;
          if (value && value.byteLength > 0) {
            chunks.push(value);
            loadedBytes += value.byteLength;

            const now = performance.now();
            if (totalBytes > 0) {
              const pct = Math.min(94, Math.max(5, Math.round((loadedBytes / totalBytes) * 94)));
              const bucket = Math.floor(pct / 15);
              if (bucket !== lastLoggedBucket) {
                lastLoggedBucket = bucket;
                console.info(
                  `[ALARA GLB] onProgress (${url}): ${pct}% (${(loadedBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} МБ)`
                );
              }
              if (now - lastUiUpdateMs >= 80 || loadedBytes >= totalBytes) {
                lastUiUpdateMs = now;
                callbacks?.onProgress?.(
                  pct,
                  `Загрузка 3D-модели АЭС (${(loadedBytes / (1024 * 1024)).toFixed(1)} / ${(totalBytes / (1024 * 1024)).toFixed(1)} МБ)...`
                );
              }
            } else if (now - lastUiUpdateMs >= 100) {
              lastUiUpdateMs = now;
              const loadedMb = (loadedBytes / (1024 * 1024)).toFixed(1);
              callbacks?.onProgress?.(50, `Загрузка 3D-модели АЭС (${loadedMb} МБ)...`);
            }
          }
        }
      } catch (err) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
        throw err;
      }

      const merged = new Uint8Array(loadedBytes);
      let offset = 0;
      for (let i = 0; i < chunks.length; i++) {
        merged.set(chunks[i], offset);
        offset += chunks[i].byteLength;
      }
      arrayBuffer = merged.buffer;
    } else {
      arrayBuffer = await response.arrayBuffer();
    }

    console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
    throwIfAborted(callbacks?.signal);

    // Быстрая проверка на случай если сервер отдал HTML без корректного заголовка
    if (arrayBuffer.byteLength > 0) {
      const head = new Uint8Array(arrayBuffer, 0, Math.min(16, arrayBuffer.byteLength));
      const headAscii = String.fromCharCode(...head).trimStart();
      if (headAscii.startsWith('<')) {
        throw new Error(
          `По пути "${url}" получен HTML вместо бинарного .glb (проверьте public/assembly.glb)`
        );
      }
    }

    return arrayBuffer;
  }

  private async loadViaGltfParse(
    url: string,
    callbacks?: NppLoadCallbacks
  ): Promise<GLTF> {
    if (!this.gltfLoader) {
      throw new Error('GLTFLoader не инициализирован');
    }

    const arrayBuffer = await this.fetchBinaryWithProgress(url, callbacks);

    // Отдаём кадр браузеру перед тяжёлым парсингом .glb (~55 МБ), чтобы прогресс 95% успел отрисоваться
    callbacks?.onProgress?.(95, 'Распаковка 3D-геометрии и текстур .glb...');
    await yieldToBrowser();
    throwIfAborted(callbacks?.signal);

    const resourcePath =
      url.startsWith('blob:') || url.startsWith('data:')
        ? ''
        : url.substring(0, url.lastIndexOf('/') + 1);

    const loader = this.gltfLoader;
    console.time('[ALARA GLB] 2. GLTFLoader.parse');

    const gltf = await new Promise<GLTF>((resolve, reject) => {
      loader.parse(
        arrayBuffer,
        resourcePath,
        parsed => {
          resolve(parsed);
        },
        err => {
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    }).finally(() => {
      console.timeEnd('[ALARA GLB] 2. GLTFLoader.parse');
    });

    if (callbacks?.signal?.aborted) {
      disposeGlbSceneHierarchy(gltf.scene);
      throwIfAborted(callbacks.signal);
    }

    console.info('[ALARA GLB] Распакована gltf.scene:', {
      url,
      children: gltf.scene.children.length,
      animations: gltf.animations.length
    });
    return gltf;
  }

  /**
   * Гарантированно загружает реальный .glb через GLTFLoader без подмены процедурными примитивами.
   */
  public async load(
    customUrl?: string,
    sourceKindOverride?: NppSceneSourceKind,
    callbacks?: NppLoadCallbacks
  ): Promise<NppLoadResult> {
    const candidateUrls = this.buildCandidateUrls(customUrl);
    const isCustom = Boolean(customUrl);
    const sourceKind: NppSceneSourceKind =
      sourceKindOverride ?? (isCustom ? 'custom_upload' : 'glb_file');

    const errors: string[] = [];

    for (const url of candidateUrls) {
      throwIfAborted(callbacks?.signal);
      const preDiag = await this.diagnoseNetworkUrl(url, callbacks?.signal);
      if (preDiag) {
        console.error(`[ALARA GLB] Предварительная проверка не пройдена для "${url}": ${preDiag}`);
        errors.push(preDiag);
        continue;
      }

      try {
        const gltf = await this.loadViaGltfParse(url, callbacks);
        try {
          return await this.finalizeWorldRootAsync(gltf.scene, sourceKind, url, callbacks);
        } catch (err) {
          disposeGlbSceneHierarchy(gltf.scene);
          throw err;
        }
      } catch (err) {
        if ((err as { name?: string })?.name === 'AbortError' || callbacks?.signal?.aborted) {
          throw err;
        }
        const rawMsg = err instanceof Error ? err.message : String(err);
        const isHtmlFallback =
          rawMsg.includes("Unexpected token '<'") || rawMsg.toLowerCase().includes('unexpected token');
        const msg = isHtmlFallback
          ? `По пути "${url}" получен HTML вместо бинарного .glb (проверьте public/assembly.glb)`
          : `Ошибка загрузки "${url}": ${rawMsg}`;
        console.error(`[ALARA GLB] ${msg}`);
        errors.push(msg);
      }
    }

    throw new Error(
      errors.join(' | ') || 'Не удалось загрузить 3D-модель АЭС (/assembly.glb).'
    );
  }

  private async finalizeWorldRootAsync(
    worldRoot: THREE.Group,
    sourceKind: NppSceneSourceKind,
    sourceUrl: string,
    callbacks?: NppLoadCallbacks
  ): Promise<NppLoadResult> {
    const signal = callbacks?.signal;
    throwIfAborted(signal);

    callbacks?.onProgress?.(95.5, 'Подготовка материалов и границ 3D-модели...');
    await yieldToBrowser();
    throwIfAborted(signal);

    console.time('[ALARA GLB] 3. Нормализация мешей и Box3');
    const tf = this.config.transform;

    // 1. Гарантируем видимость всей иерархии и собираем меши за один быстрый проход
    worldRoot.visible = true;
    worldRoot.layers.enableAll();
    worldRoot.position.set(0, 0, 0);
    worldRoot.rotation.set(0, 0, 0);
    worldRoot.scale.setScalar(1);
    worldRoot.updateMatrixWorld(true);

    const allMeshes: THREE.Mesh[] = [];
    let hasEmbeddedLights = false;

    worldRoot.traverse(obj => {
      obj.visible = true;
      obj.layers.enableAll();
      if ((obj as THREE.Mesh).isMesh) {
        allMeshes.push(obj as THREE.Mesh);
      } else if ((obj as THREE.Light).isLight) {
        hasEmbeddedLights = true;
      }
    });

    const meshCount = allMeshes.length;
    const seenMaterials = new Set<THREE.Material>();
    const seenTextures = new Set<THREE.Texture>();
    const rawBox = new THREE.Box3();
    const tmpBox = new THREE.Box3();
    const tmpSize = new THREE.Vector3();

    let fixedOpacityCount = 0;
    let sliceStartMs = performance.now();

    // 2. Пошаговая обработка мешей и уникальных материалов с уступкой кадру (чтобы не вешать UI)
    for (let i = 0; i < meshCount; i++) {
      const mesh = allMeshes[i];
      mesh.visible = true;
      mesh.frustumCulled = true;
      mesh.receiveShadow = true;

      let diag = 0;
      if (mesh.geometry) {
        if (!mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }
        if (mesh.geometry.boundingBox) {
          tmpBox.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
          if (!tmpBox.isEmpty()) {
            rawBox.union(tmpBox);
            tmpBox.getSize(tmpSize);
            diag = tmpSize.length();
          }
        }
      }

      // Не нагружаем shadow map тысячами мелких крепёжных/кабельных сабмешей в 55 МБ модели
      mesh.castShadow = meshCount <= 350 || diag >= 1.4;

      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      for (let mi = 0; mi < mats.length; mi++) {
        const m = mats[mi];
        if (!m || seenMaterials.has(m)) continue;
        seenMaterials.add(m);

        m.visible = true;
        let needsMatUpdate = false;

        if (m.transparent && m.opacity <= 0.001) {
          m.opacity = 1.0;
          m.transparent = false;
          fixedOpacityCount += 1;
          needsMatUpdate = true;
        }

        const std = m as THREE.MeshStandardMaterial;
        if (std.map && !seenTextures.has(std.map)) {
          seenTextures.add(std.map);
          if (std.map.colorSpace !== THREE.SRGBColorSpace) {
            std.map.colorSpace = THREE.SRGBColorSpace;
            std.map.needsUpdate = true;
          }
        }
        if (std.emissiveMap && !seenTextures.has(std.emissiveMap)) {
          seenTextures.add(std.emissiveMap);
          if (std.emissiveMap.colorSpace !== THREE.SRGBColorSpace) {
            std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            std.emissiveMap.needsUpdate = true;
          }
        }
        if (typeof std.envMapIntensity === 'number' && std.envMapIntensity < 1.0) {
          std.envMapIntensity = 1.15;
          needsMatUpdate = true;
        }
        if (needsMatUpdate) {
          m.needsUpdate = true;
        }
      }

      if (i > 0 && (i % 240 === 0 || performance.now() - sliceStartMs > 12)) {
        await yieldToBrowser();
        throwIfAborted(signal);
        sliceStartMs = performance.now();
      }
    }

    // 3. Единое вычисление поворота, масштаба и центрирования (без лишних обходов Box3.setFromObject)
    const rawSize = new THREE.Vector3();
    let rawMinArr: readonly [number, number, number] = [0, 0, 0];
    let rawMaxArr: readonly [number, number, number] = [0, 0, 0];
    let rawSizeArr: readonly [number, number, number] = [0, 0, 0];
    let appliedRotationDeg: readonly [number, number, number] = [0, 0, 0];
    let appliedScale = 1.0;

    if (!rawBox.isEmpty()) {
      rawBox.getSize(rawSize);
      rawMinArr = [
        Number(rawBox.min.x.toFixed(2)),
        Number(rawBox.min.y.toFixed(2)),
        Number(rawBox.min.z.toFixed(2))
      ];
      rawMaxArr = [
        Number(rawBox.max.x.toFixed(2)),
        Number(rawBox.max.y.toFixed(2)),
        Number(rawBox.max.z.toFixed(2))
      ];
      rawSizeArr = [
        Number(rawSize.x.toFixed(2)),
        Number(rawSize.y.toFixed(2)),
        Number(rawSize.z.toFixed(2))
      ];

      console.info('[ALARA GLB] Исходный Box3 до нормализации:', {
        min: rawMinArr,
        max: rawMaxArr,
        size: rawSizeArr,
        meshCount,
        uniqueMaterials: seenMaterials.size,
        fixedOpacityCount
      });

      const isFlatVerticalPanel =
        rawSize.y > 0.001 &&
        rawSize.z < rawSize.y * 0.85 &&
        rawSize.x > rawSize.z * 1.15;

      const shouldRotate =
        tf.orientationMode === 'always' ||
        (tf.orientationMode === 'auto_z_up' && isFlatVerticalPanel);

      let rotated = false;
      if (shouldRotate) {
        appliedRotationDeg = [
          tf.rotationDeg[0],
          tf.rotationDeg[1] + tf.yawDeg,
          tf.rotationDeg[2]
        ];
        worldRoot.rotation.set(
          THREE.MathUtils.degToRad(tf.rotationDeg[0]),
          THREE.MathUtils.degToRad(tf.rotationDeg[1]),
          THREE.MathUtils.degToRad(tf.rotationDeg[2]),
          'XYZ'
        );
        if (Math.abs(tf.yawDeg) > 0.01) {
          worldRoot.rotateOnWorldAxis(
            new THREE.Vector3(0, 1, 0),
            THREE.MathUtils.degToRad(tf.yawDeg)
          );
        }
        rotated = true;
        console.info(
          `[ALARA GLB] Применён поворот ориентации (${tf.orientationMode}): X=${tf.rotationDeg[0]}°, Yaw=${tf.yawDeg}°`
        );
      } else if (Math.abs(tf.yawDeg) > 0.01) {
        appliedRotationDeg = [0, tf.yawDeg, 0];
        worldRoot.rotateOnWorldAxis(
          new THREE.Vector3(0, 1, 0),
          THREE.MathUtils.degToRad(tf.yawDeg)
        );
        rotated = true;
      }

      const orientedBox = new THREE.Box3();
      if (rotated) {
        worldRoot.updateMatrixWorld(true);
        for (let i = 0; i < meshCount; i++) {
          const bb = allMeshes[i].geometry?.boundingBox;
          if (!bb) continue;
          tmpBox.copy(bb).applyMatrix4(allMeshes[i].matrixWorld);
          orientedBox.union(tmpBox);
        }
      } else {
        orientedBox.copy(rawBox);
      }

      const orientedSize = new THREE.Vector3();
      orientedBox.getSize(orientedSize);
      const horizMax = Math.max(orientedSize.x, orientedSize.z, 0.001);

      if (tf.targetFootprintMeters > 0) {
        appliedScale = (tf.targetFootprintMeters / horizMax) * tf.scaleMultiplier;
      } else {
        appliedScale = tf.scaleMultiplier;
      }
      worldRoot.scale.setScalar(appliedScale);

      // Вычисляем масштабированный Box3 аналитически без повторного обхода сцены
      const scaledBox = orientedBox.clone();
      scaledBox.min.multiplyScalar(appliedScale);
      scaledBox.max.multiplyScalar(appliedScale);
      const scaledCenter = new THREE.Vector3();
      scaledBox.getCenter(scaledCenter);

      if (tf.centerXZ) {
        worldRoot.position.x -= scaledCenter.x;
        worldRoot.position.z -= scaledCenter.z;
      }
      if (tf.alignBottomToZeroY && Number.isFinite(scaledBox.min.y)) {
        worldRoot.position.y -= scaledBox.min.y;
      }
      worldRoot.position.x += tf.positionOffset[0];
      worldRoot.position.y += tf.positionOffset[1];
      worldRoot.position.z += tf.positionOffset[2];
      worldRoot.updateMatrixWorld(true);

      const finalBox = scaledBox.clone().translate(worldRoot.position);
      const finalSize = new THREE.Vector3();
      finalBox.getSize(finalSize);
      console.info('[ALARA GLB] Итоговый Box3 после нормализации:', {
        appliedRotationDeg,
        appliedScale: Number(appliedScale.toFixed(4)),
        min: finalBox.min.toArray().map(n => Number(n.toFixed(2))),
        max: finalBox.max.toArray().map(n => Number(n.toFixed(2))),
        size: finalSize.toArray().map(n => Number(n.toFixed(2)))
      });
    } else {
      console.warn('[ALARA GLB] Загруженный gltf.scene имеет пустой Box3 (нет видимой геометрии).');
    }

    if (!hasEmbeddedLights) {
      const glbFillLight = new THREE.HemisphereLight(0xf1f5f9, 0x334155, 0.85);
      glbFillLight.name = 'glb_hemisphere_fill_light';
      worldRoot.add(glbFillLight);
    }
    console.timeEnd('[ALARA GLB] 3. Нормализация мешей и Box3');

    // 4. Асинхронная инспекция графа сцены с AABB-индексом и уступками кадру
    callbacks?.onProgress?.(96, 'Анализ узлов, зданий и входов модели АЭС...');
    await yieldToBrowser();
    throwIfAborted(signal);

    console.time('[ALARA GLB] 4. Инспекция графа АЭС');
    const report = await inspectNppSceneGraphAsync(
      worldRoot,
      this.config,
      sourceKind,
      sourceUrl,
      {
        rawBoundingBoxMin: rawMinArr,
        rawBoundingBoxMax: rawMaxArr,
        rawBoundingBoxSize: rawSizeArr,
        appliedRotationDeg,
        appliedScale
      },
      {
        signal,
        onStepProgress: callbacks?.onProgress
      }
    );
    console.timeEnd('[ALARA GLB] 4. Инспекция графа АЭС');

    callbacks?.onProgress?.(97.5, 'Подготовка игровых систем АЭС...');
    return {
      sceneRoot: worldRoot,
      report,
      resolvedUrl: sourceUrl
    };
  }

  public dispose(): void {
    if (this.dracoLoader) {
      this.dracoLoader.dispose();
      this.dracoLoader = null;
    }
    this.gltfLoader = null;
  }
}
