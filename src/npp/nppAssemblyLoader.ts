/**
 * ALARA — Загрузчик оригинальной 3D-модели АЭС (/assembly.glb) через GLTFLoader
 * с синглтон-декодерами (условное подключение Draco / Meshopt), потоковым скачиванием с AbortSignal,
 * кэшированием нормализованной сборки в памяти на время сессии и временны́м бюджетом кадров (14 мс).
 *
 * ВАЖНО: Никакой подмены процедурной комнатой/примитивами!
 * При ошибке загрузки возвращается явная ошибка в консоль и HUD.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { NPP_NODE_CONFIG, NppAssemblyConfig, SCENARIO_4_CONFIG } from './nppNodeConfig';
import {
  createFrameYieldBudget,
  FrameYieldBudget,
  inspectNppSceneGraphAsync,
  NppInspectionReport,
  NppSceneSourceKind,
  throwIfAborted,
  yieldIfBudgetExceeded,
  yieldToBrowser
} from './nppSceneInspector';

export interface NppLoadResult {
  readonly sceneRoot: THREE.Group;
  readonly report: NppInspectionReport;
  readonly resolvedUrl: string;
  readonly groundMeshes: ReadonlyArray<THREE.Mesh>;
  readonly fromCache: boolean;
}

export interface NppLoadCallbacks {
  readonly signal?: AbortSignal;
  readonly forceReload?: boolean;
  readonly cacheKey?: string;
  readonly onProgress?: (progressPct: number, statusTextRu: string) => void;
}

interface CachedNppAsset {
  readonly cacheKey: string;
  readonly resolvedUrl: string;
  readonly sceneRoot: THREE.Group;
  readonly report: NppInspectionReport;
  readonly groundMeshes: THREE.Mesh[];
}

const DEFAULT_NPP_CACHE_KEY = 'default::assembly.glb';

// Синглтон-декодеры и загрузчики переиспользуются между повторными запусками Сценария №4
let sharedPlainGltfLoader: GLTFLoader | null = null;
let sharedCompressedGltfLoader: GLTFLoader | null = null;
let sharedDracoLoader: DRACOLoader | null = null;
let sharedDracoDecoderPath = '';

// Сессионный кэш нормализованного /assembly.glb (максимум 1 активная модель в памяти)
let sessionGlbCache: CachedNppAsset | null = null;

export function isSessionCachedGlbRoot(root: THREE.Object3D | null): boolean {
  return Boolean(root && sessionGlbCache && sessionGlbCache.sceneRoot === root);
}

export function clearNppSessionCache(): void {
  if (!sessionGlbCache) return;
  disposeGlbSceneHierarchy(sessionGlbCache.sceneRoot);
  sessionGlbCache = null;
}

function getPlainGltfLoader(): GLTFLoader {
  if (!sharedPlainGltfLoader) {
    sharedPlainGltfLoader = new GLTFLoader();
  }
  return sharedPlainGltfLoader;
}

function getCompressedGltfLoader(dracoPath: string, needsDraco: boolean, needsMeshopt: boolean): GLTFLoader {
  if (needsDraco && (!sharedDracoLoader || sharedDracoDecoderPath !== dracoPath)) {
    if (sharedDracoLoader) {
      sharedDracoLoader.dispose();
    }
    sharedDracoLoader = new DRACOLoader();
    sharedDracoLoader.setDecoderPath(dracoPath);
    sharedDracoDecoderPath = dracoPath;
  }

  if (!sharedCompressedGltfLoader) {
    sharedCompressedGltfLoader = new GLTFLoader();
  }
  if (needsDraco && sharedDracoLoader) {
    sharedCompressedGltfLoader.setDRACOLoader(sharedDracoLoader);
  }
  if (needsMeshopt) {
    sharedCompressedGltfLoader.setMeshoptDecoder(MeshoptDecoder);
  }
  return sharedCompressedGltfLoader;
}

/**
 * Быстро читает заголовок бинарного .glb (JSON-чанк) за O(1),
 * чтобы не поднимать WASM-декодеры Draco/Meshopt, если модель в них не нуждается.
 */
function inspectGlbDecoderRequirements(buffer: ArrayBuffer): {
  needsDraco: boolean;
  needsMeshopt: boolean;
} {
  if (buffer.byteLength < 20) {
    return { needsDraco: true, needsMeshopt: true };
  }
  const view = new DataView(buffer);
  const magic = view.getUint32(0, true);
  // 0x46546C67 === 'glTF'
  if (magic !== 0x46546c67) {
    return { needsDraco: true, needsMeshopt: true };
  }

  const chunkLen = view.getUint32(12, true);
  const chunkType = view.getUint32(16, true);
  // 0x4E4F534A === 'JSON'
  if (chunkType !== 0x4e4f534a || 20 + chunkLen > buffer.byteLength) {
    return { needsDraco: true, needsMeshopt: true };
  }

  try {
    const jsonBytes = new Uint8Array(buffer, 20, chunkLen);
    const jsonStr = new TextDecoder().decode(jsonBytes);
    const parsed = JSON.parse(jsonStr) as {
      extensionsUsed?: string[];
      extensionsRequired?: string[];
    };
    const used = new Set<string>([
      ...(parsed.extensionsUsed ?? []),
      ...(parsed.extensionsRequired ?? [])
    ]);
    return {
      needsDraco: used.has('KHR_draco_mesh_compression'),
      needsMeshopt: used.has('EXT_meshopt_compression')
    };
  } catch {
    return { needsDraco: true, needsMeshopt: true };
  }
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

  constructor(config: NppAssemblyConfig = NPP_NODE_CONFIG) {
    this.config = config;
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

  private async fetchBinaryWithProgress(
    url: string,
    callbacks?: NppLoadCallbacks
  ): Promise<ArrayBuffer> {
    throwIfAborted(callbacks?.signal);
    console.info(`[ALARA GLB] Старт загрузки: "${url}"`);
    console.time('[ALARA GLB] 1. Скачивание .glb');
    callbacks?.onProgress?.(5, `Загрузка ${url}...`);

    // Объединяем проверку заголовка и скачивание в один fetch без лишнего предварительного HEAD-запроса
    const response = await fetch(url, { signal: callbacks?.signal });
    if (!response.ok) {
      console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
      throw new Error(`HTTP ${response.status} (${response.statusText || 'Not Found'}) по адресу "${url}"`);
    }

    const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
    if (contentType.includes('text/html')) {
      console.timeEnd('[ALARA GLB] 1. Скачивание .glb');
      throw new Error(
        `Сервер вернул HTML-страницу (${contentType}) вместо бинарного .glb — проверьте наличие public/assembly.glb`
      );
    }

    const contentLengthHeader = response.headers.get('content-length');
    const totalBytes = contentLengthHeader ? Number(contentLengthHeader) : 0;

    let arrayBuffer: ArrayBuffer;
    if (response.body && typeof response.body.getReader === 'function') {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let loadedBytes = 0;
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
              if (now - lastUiUpdateMs >= 85 || loadedBytes >= totalBytes) {
                lastUiUpdateMs = now;
                const pct = Math.min(94, Math.max(5, Math.round((loadedBytes / totalBytes) * 94)));
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
    const arrayBuffer = await this.fetchBinaryWithProgress(url, callbacks);

    const { needsDraco, needsMeshopt } = inspectGlbDecoderRequirements(arrayBuffer);
    const loader =
      needsDraco || needsMeshopt
        ? getCompressedGltfLoader(this.config.dracoDecoderPath, needsDraco, needsMeshopt)
        : getPlainGltfLoader();

    console.info(`[ALARA GLB] Декодеры: Draco=${needsDraco}, Meshopt=${needsMeshopt}`);

    // Единичная уступка кадру, чтобы HUD успел показать "Распаковка" перед парсингом
    callbacks?.onProgress?.(95, 'Распаковка 3D-геометрии и текстур .glb...');
    await yieldToBrowser();
    throwIfAborted(callbacks?.signal);

    const resourcePath =
      url.startsWith('blob:') || url.startsWith('data:')
        ? ''
        : url.substring(0, url.lastIndexOf('/') + 1);

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

    return gltf;
  }

  /**
   * Загружает реальный .glb с поддержкой сессионного кэша в памяти для мгновенного повторного запуска.
   */
  public async load(
    customUrl?: string,
    sourceKindOverride?: NppSceneSourceKind,
    callbacks?: NppLoadCallbacks
  ): Promise<NppLoadResult> {
    const isCustom = Boolean(customUrl);
    const cacheKey = callbacks?.cacheKey ?? (customUrl ? `custom::${customUrl}` : DEFAULT_NPP_CACHE_KEY);

    if (!callbacks?.forceReload && sessionGlbCache && sessionGlbCache.cacheKey === cacheKey) {
      throwIfAborted(callbacks?.signal);
      callbacks?.onProgress?.(97.5, 'Модель АЭС восстановлена из кэша сессии...');
      console.info(`[ALARA GLB] Мгновенная загрузка из сессионного кэша (${sessionGlbCache.resolvedUrl})`);
      sessionGlbCache.sceneRoot.visible = true;
      return {
        sceneRoot: sessionGlbCache.sceneRoot,
        report: sessionGlbCache.report,
        resolvedUrl: sessionGlbCache.resolvedUrl,
        groundMeshes: sessionGlbCache.groundMeshes,
        fromCache: true
      };
    }

    // Освобождаем предыдущий сессионный кэш при загрузке другой модели или принудительном обновлении
    if (sessionGlbCache && (sessionGlbCache.cacheKey !== cacheKey || callbacks?.forceReload)) {
      clearNppSessionCache();
    }

    const candidateUrls = this.buildCandidateUrls(customUrl);
    const sourceKind: NppSceneSourceKind =
      sourceKindOverride ?? (isCustom ? 'custom_upload' : 'glb_file');

    const errors: string[] = [];

    for (const url of candidateUrls) {
      throwIfAborted(callbacks?.signal);
      try {
        const gltf = await this.loadViaGltfParse(url, callbacks);
        try {
          const result = await this.finalizeWorldRootAsync(gltf.scene, sourceKind, url, callbacks);
          // Сохраняем нормализованный корень и отчёт в сессионный кэш
          sessionGlbCache = {
            cacheKey,
            resolvedUrl: result.resolvedUrl,
            sceneRoot: result.sceneRoot,
            report: result.report,
            groundMeshes: [...result.groundMeshes]
          };
          return result;
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
    const budget: FrameYieldBudget = createFrameYieldBudget();
    throwIfAborted(signal);

    callbacks?.onProgress?.(95.5, 'Нормализация материалов и границ 3D-модели...');

    console.time('[ALARA GLB] 3. Нормализация мешей и Box3');
    const tf = this.config.transform;

    // 1. Гарантируем видимость иерархии и собираем меши за один проход
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

    // 2. Пошаговая нормализация с временны́м бюджетом 14 мс (без холостых rAF-пауз)
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

      // Тени только на крупных строительных элементах, без мелких крепёжных деталей
      mesh.castShadow = meshCount <= 300 || diag >= 1.8;

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

      if ((i & 63) === 63) {
        await yieldIfBudgetExceeded(budget, 14, signal);
      }
    }

    // 3. Единое вычисление поворота, масштаба и центрирования
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

      console.info('[ALARA GLB] Нормализация завершена:', {
        meshCount,
        uniqueMaterials: seenMaterials.size,
        fixedOpacityCount,
        appliedScale: Number(appliedScale.toFixed(4))
      });
    }

    if (!hasEmbeddedLights) {
      const glbFillLight = new THREE.HemisphereLight(0xf1f5f9, 0x334155, 0.85);
      glbFillLight.name = 'glb_hemisphere_fill_light';
      worldRoot.add(glbFillLight);
    }
    console.timeEnd('[ALARA GLB] 3. Нормализация мешей и Box3');

    // 4. Асинхронная инспекция графа сцены с общим бюджетом кадра
    callbacks?.onProgress?.(96, 'Анализ узлов и корпусов модели АЭС...');
    await yieldIfBudgetExceeded(budget, 14, signal);

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
        budget,
        onStepProgress: callbacks?.onProgress
      }
    );
    console.timeEnd('[ALARA GLB] 4. Инспекция графа АЭС');

    // 5. Предварительная фильтрация напольных/площадочных мешей для быстрого Raycast АЦ-40
    const maxStep = SCENARIO_4_CONFIG.VEHICLE.driveBounds.maxDeckStepHeightM;
    const minGroundY = report.deckSurfaceY - 2.0;
    const maxGroundY = report.deckSurfaceY + maxStep + 1.0;
    const groundMeshes: THREE.Mesh[] = [];
    for (let i = 0; i < meshCount; i++) {
      const mesh = allMeshes[i];
      const bb = mesh.geometry?.boundingBox;
      if (!bb) continue;
      tmpBox.copy(bb).applyMatrix4(mesh.matrixWorld);
      if (tmpBox.min.y > maxGroundY || tmpBox.max.y < minGroundY) continue;
      tmpBox.getSize(tmpSize);
      if (Math.max(tmpSize.x, tmpSize.z) >= 1.2) {
        groundMeshes.push(mesh);
      }
    }

    callbacks?.onProgress?.(97.5, 'Подготовка игровых систем АЭС...');
    return {
      sceneRoot: worldRoot,
      report,
      resolvedUrl: sourceUrl,
      groundMeshes: groundMeshes.length > 0 ? groundMeshes : allMeshes,
      fromCache: false
    };
  }

  public dispose(): void {
    // Синглтон-декодеры DRACOLoader/GLTFLoader и sessionGlbCache сохраняются между переключениями сценариев
  }
}
