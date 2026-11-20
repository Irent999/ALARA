/**
 * ALARA — Загрузчик оригинальной 3D-модели АЭС (/assembly.glb) через GLTFLoader
 * с поддержкой Draco + Meshopt компрессии, проверкой материалов/видимости,
 * нормализацией масштаба/ориентации и подробным логированием.
 *
 * ВАЖНО: Никакой подмены процедурной комнатой/примитивами!
 * При ошибке загрузки возвращается явная ошибка в консоль и HUD.
 */

import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { NPP_NODE_CONFIG, NppAssemblyConfig } from './nppNodeConfig';
import { inspectNppSceneGraph, NppInspectionReport, NppSceneSourceKind } from './nppSceneInspector';

export interface NppLoadResult {
  readonly sceneRoot: THREE.Group;
  readonly report: NppInspectionReport;
  readonly resolvedUrl: string;
}

export interface NppLoadCallbacks {
  readonly onProgress?: (progressPct: number, statusTextRu: string) => void;
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

  private async diagnoseNetworkUrl(url: string): Promise<string | null> {
    if (url.startsWith('blob:') || url.startsWith('data:')) return null;
    try {
      const res = await fetch(url, { method: 'HEAD' });
      const ct = res.headers.get('content-type') ?? 'unknown';
      if (!res.ok) {
        return `HTTP ${res.status} (${res.statusText || 'Not Found'}) по адресу "${url}"`;
      }
      if (ct.toLowerCase().includes('text/html')) {
        return `Сервер вернул HTML-страницу (SPA fallback, content-type: ${ct}) вместо бинарного .glb — проверьте наличие файла public/assembly.glb`;
      }
      return null;
    } catch {
      return null;
    }
  }

  private loadViaGltfLoader(
    url: string,
    callbacks?: NppLoadCallbacks
  ): Promise<GLTF> {
    return new Promise((resolve, reject) => {
      if (!this.gltfLoader) {
        reject(new Error('GLTFLoader не инициализирован'));
        return;
      }

      const startMs = performance.now();
      let lastLoggedBucket = -1;
      console.info(`[ALARA GLB] Старт загрузки GLTFLoader: "${url}" (Draco: "${this.config.dracoDecoderPath}")`);
      callbacks?.onProgress?.(5, `Загрузка ${url}...`);

      this.gltfLoader.load(
        url,
        gltf => {
          const elapsedMs = Math.round(performance.now() - startMs);
          console.info(`[ALARA GLB] Успешно загружен gltf.scene за ${elapsedMs} мс:`, {
            url,
            children: gltf.scene.children.length,
            animations: gltf.animations.length
          });
          resolve(gltf);
        },
        xhr => {
          if (xhr.lengthComputable && xhr.total > 0) {
            const pct = Math.min(95, Math.max(5, Math.round((xhr.loaded / xhr.total) * 100)));
            const bucket = Math.floor(pct / 15);
            if (bucket !== lastLoggedBucket) {
              lastLoggedBucket = bucket;
              const loadedMb = (xhr.loaded / (1024 * 1024)).toFixed(1);
              const totalMb = (xhr.total / (1024 * 1024)).toFixed(1);
              console.info(`[ALARA GLB] onProgress (${url}): ${pct}% (${loadedMb} / ${totalMb} МБ)`);
            }
            callbacks?.onProgress?.(
              pct,
              `Загрузка 3D-модели АЭС (${(xhr.loaded / (1024 * 1024)).toFixed(1)} / ${(xhr.total / (1024 * 1024)).toFixed(1)} МБ)...`
            );
          } else {
            const loadedMb = (xhr.loaded / (1024 * 1024)).toFixed(1);
            callbacks?.onProgress?.(45, `Загрузка 3D-модели АЭС (${loadedMb} МБ)...`);
          }
        },
        err => {
          console.error(`[ALARA GLB] onError при загрузке "${url}":`, err);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      );
    });
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
    const sourceKind: NppSceneSourceKind = sourceKindOverride ?? (isCustom ? 'custom_upload' : 'glb_file');

    const errors: string[] = [];

    for (const url of candidateUrls) {
      const preDiag = await this.diagnoseNetworkUrl(url);
      if (preDiag) {
        console.error(`[ALARA GLB] Предварительная проверка не пройдена для "${url}": ${preDiag}`);
        errors.push(preDiag);
        continue;
      }

      try {
        const gltf = await this.loadViaGltfLoader(url, callbacks);
        callbacks?.onProgress?.(96, 'Анализ узлов, материалов и Box3 модели АЭС...');
        return this.finalizeWorldRoot(gltf.scene, sourceKind, url, callbacks);
      } catch (err) {
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

  private finalizeWorldRoot(
    worldRoot: THREE.Group,
    sourceKind: NppSceneSourceKind,
    sourceUrl: string,
    callbacks?: NppLoadCallbacks
  ): NppLoadResult {
    // 1. Гарантируем видимость всей иерархии и слоёв
    worldRoot.visible = true;
    worldRoot.layers.enableAll();
    worldRoot.scale.setScalar(this.config.targetUnitScale);
    worldRoot.updateMatrixWorld(true);

    let meshCount = 0;
    let fixedOpacityCount = 0;

    worldRoot.traverse(obj => {
      obj.visible = true;
      obj.layers.enableAll();

      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        meshCount += 1;
        mesh.visible = true;
        mesh.frustumCulled = true;
        mesh.castShadow = true;
        mesh.receiveShadow = true;

        if (mesh.geometry && !mesh.geometry.boundingBox) {
          mesh.geometry.computeBoundingBox();
        }

        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach(m => {
          if (!m) return;
          m.visible = true;
          if (m.transparent && m.opacity <= 0.001) {
            m.opacity = 1.0;
            m.transparent = false;
            fixedOpacityCount += 1;
          }
          const std = m as THREE.MeshStandardMaterial;
          if (std.map) {
            std.map.colorSpace = THREE.SRGBColorSpace;
            std.map.needsUpdate = true;
          }
          if (std.emissiveMap) {
            std.emissiveMap.colorSpace = THREE.SRGBColorSpace;
            std.emissiveMap.needsUpdate = true;
          }
          if (typeof std.envMapIntensity === 'number' && std.envMapIntensity < 1.0) {
            std.envMapIntensity = 1.15;
          }
          m.needsUpdate = true;
        });
      }
    });

    // 2. Анализ исходного Box3, нормализация масштаба и выравнивание по полу Y = 0
    const rawBox = new THREE.Box3().setFromObject(worldRoot);
    const rawSize = new THREE.Vector3();
    const rawCenter = new THREE.Vector3();

    if (!rawBox.isEmpty()) {
      rawBox.getSize(rawSize);
      rawBox.getCenter(rawCenter);
      console.info('[ALARA GLB] Исходный Box3 до нормализации:', {
        min: rawBox.min.toArray().map(n => Number(n.toFixed(2))),
        max: rawBox.max.toArray().map(n => Number(n.toFixed(2))),
        size: rawSize.toArray().map(n => Number(n.toFixed(2))),
        meshCount,
        fixedOpacityCount
      });

      const maxDim = Math.max(rawSize.x, rawSize.y, rawSize.z);
      if (maxDim > 400) {
        const autoScale = maxDim > 4000 ? 0.001 : 0.01;
        worldRoot.scale.multiplyScalar(autoScale);
        worldRoot.updateMatrixWorld(true);
        console.info(`[ALARA GLB] Авто-масштабирование (см/мм -> м): ×${autoScale}`);
      } else if (maxDim > 0 && maxDim < 1.5) {
        const autoScale = maxDim < 0.25 ? 40 : 10;
        worldRoot.scale.multiplyScalar(autoScale);
        worldRoot.updateMatrixWorld(true);
        console.info(`[ALARA GLB] Авто-масштабирование (миниатюра -> м): ×${autoScale}`);
      }

      const scaledBox = new THREE.Box3().setFromObject(worldRoot);
      const scaledCenter = new THREE.Vector3();
      scaledBox.getCenter(scaledCenter);

      // Ставим основание модели на Y = 0
      if (this.config.alignBottomToZeroY && Number.isFinite(scaledBox.min.y)) {
        worldRoot.position.y -= scaledBox.min.y;
      }
      // Если модель смещена далеко от начала координат (> 25 м), центрируем в XZ для точности теней и WebXR
      if (Math.hypot(scaledCenter.x, scaledCenter.z) > 25) {
        worldRoot.position.x -= scaledCenter.x;
        worldRoot.position.z -= scaledCenter.z;
        console.info(
          `[ALARA GLB] Центрирование XZ смещённой модели к (0, 0) с (${scaledCenter.x.toFixed(1)}, ${scaledCenter.z.toFixed(1)})`
        );
      }
      worldRoot.updateMatrixWorld(true);
    } else {
      console.warn('[ALARA GLB] Загруженный gltf.scene имеет пустой Box3 (нет видимой геометрии).');
    }

    // 3. Добавляем мягкий заполняющий свет, если внутри gltf.scene нет встроенных источников света
    let hasEmbeddedLights = false;
    worldRoot.traverse(o => {
      if ((o as THREE.Light).isLight) hasEmbeddedLights = true;
    });
    if (!hasEmbeddedLights) {
      const glbFillLight = new THREE.HemisphereLight(0xf1f5f9, 0x334155, 0.85);
      glbFillLight.name = 'glb_hemisphere_fill_light';
      worldRoot.add(glbFillLight);
    }

    // 4. Инспекция графа сцены и регистрация именованных узлов
    const report = inspectNppSceneGraph(worldRoot, this.config, sourceKind, sourceUrl);
    callbacks?.onProgress?.(100, '3D-модель АЭС загружена');

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
