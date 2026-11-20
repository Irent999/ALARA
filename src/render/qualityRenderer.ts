/**
 * qualityRenderer.ts — настройка рендерера, окружения (HDRI), теней и PBR-материалов.
 *
 * Работает в обычном режиме И в WebXR (здесь нет постобработки).
 * Постобработка (SSAO/Bloom/SMAA) — в postFx.ts, она включается только на десктопе.
 *
 * Версия three: 0.186. Важно: PCFSoftShadowMap в r186 удалён — используйте PCFShadowMap
 * (в новых версиях он уже даёт мягкие края, ширина регулируется light.shadow.radius).
 */

import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js'; // RGBELoader с r180 — устаревший алиас
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ============================================================================
// 1. ПРЕСЕТЫ КАЧЕСТВА
// ============================================================================

export type QualityPreset = 'low' | 'medium' | 'high' | 'ultra';

export interface QualityConfig {
  pixelRatioMax: number;
  shadowMapSize: number;
  anisotropy: number; // будет ограничено возможностями GPU (обычно 16)
  msaaSamples: number; // MSAA для рендер-таргета постобработки (0/2/4/8)
  ssao: boolean;
  ssaoSamples: number;
  bloom: boolean;
  smaa: boolean; // SMAA сверху MSAA нужен редко; включайте при msaaSamples = 0
}

export const QUALITY_PRESETS: Record<QualityPreset, QualityConfig> = {
  // bloom по умолчанию ВЫКЛЮЧЕН: в светлых сценах (белые стены) он накрывает кадр «туманом».
  // Включайте вручную (postFx.setBloomEnabled(true)) и поднимайте bloomThreshold, если нужны блики.
  low: { pixelRatioMax: 1, shadowMapSize: 1024, anisotropy: 4, msaaSamples: 0, ssao: false, ssaoSamples: 8, bloom: false, smaa: true },
  medium: { pixelRatioMax: 1.5, shadowMapSize: 2048, anisotropy: 8, msaaSamples: 2, ssao: true, ssaoSamples: 8, bloom: false, smaa: false },
  high: { pixelRatioMax: 2, shadowMapSize: 4096, anisotropy: 16, msaaSamples: 4, ssao: true, ssaoSamples: 16, bloom: false, smaa: false },
  ultra: { pixelRatioMax: 2, shadowMapSize: 4096, anisotropy: 16, msaaSamples: 8, ssao: true, ssaoSamples: 32, bloom: false, smaa: true }
};

// ============================================================================
// 2. РЕНДЕРЕР
// ============================================================================

/**
 * Применяет «кинематографические» настройки к уже созданному WebGLRenderer.
 * Замените вызов configurePhotorealisticRendererAndHDRI(renderer, scene) на этот.
 *
 * Создавать рендерер рекомендуется так (powerPreference — выбор дискретной видеокарты):
 *   new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' })
 * antialias:true даёт MSAA в обычном режиме и в WebXR (в композере MSAA делается отдельно).
 *
 * Тон-маппинг и экспозицию по умолчанию НЕ меняет (чтобы сохранить ваш текущий вид сцены).
 * Хотите «киношную» кривую ACES — передайте { toneMapping: true, exposure: 1.0 }.
 *
 * @returns реально применённое значение анизотропии
 */
export function configureQualityRenderer(
  renderer: THREE.WebGLRenderer,
  preset: QualityPreset = 'high',
  opts: { toneMapping?: boolean; exposure?: number } = {}
): number {
  const cfg = QUALITY_PRESETS[preset];

  // Цвет: все расчёты линейные, на выход — sRGB
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  if (opts.toneMapping) {
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = opts.exposure ?? 1.0;
  }

  // Тени
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, cfg.pixelRatioMax));

  // Для VR: 1.0 = нативное разрешение шлема; 1.2–1.5 чётче, но тяжелее (нужен запас по GPU)
  renderer.xr.setFramebufferScaleFactor(1.0);

  return Math.min(cfg.anisotropy, renderer.capabilities.getMaxAnisotropy());
}

// ============================================================================
// 3. ОКРУЖЕНИЕ: HDRI → PMREM (отражения на металле + мягкий «GI»-свет)
// ============================================================================

export interface EnvironmentOptions {
  /** Путь к .hdr (equirectangular). Если не задан — встроенная «комната» RoomEnvironment. */
  hdriUrl?: string;
  /** Сила освещения окружением (аналог GI). 0.6–1.2 */
  intensity?: number;
  /** Показывать HDRI как фон (для интерьера обычно false — фон задаёт сцена) */
  showBackground?: boolean;
  backgroundBlurriness?: number;
}

/**
 * Загружает окружение и назначает scene.environment.
 * Все PBR-материалы автоматически получают отражения и рассеянный свет от него.
 */
export async function setupEnvironment(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  opts: EnvironmentOptions = {}
): Promise<THREE.Texture> {
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envMap: THREE.Texture;

  if (opts.hdriUrl) {
    const hdr = await new HDRLoader().loadAsync(opts.hdriUrl);
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    envMap = pmrem.fromEquirectangular(hdr).texture;
    hdr.dispose();
  } else {
    // Нет HDRI-файла — процедурная студийная комната: уже даёт честные блики на хроме.
    envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  }
  pmrem.dispose();

  scene.environment = envMap;
  scene.environmentIntensity = opts.intensity ?? 1.0;
  if (opts.showBackground) {
    scene.background = envMap;
    scene.backgroundBlurriness = opts.backgroundBlurriness ?? 0.0;
  }
  return envMap;
}

// ============================================================================
// 4. СОЛНЦЕ / ОСНОВНОЙ СВЕТ С ТЕНЯМИ
// ============================================================================

export interface SunOptions {
  color?: number;
  intensity?: number;
  /** Направление ОТ сцены К солнцу (нормализуется) */
  direction?: THREE.Vector3;
  /** Границы области, которая должна попадать в карту теней (вся комната) */
  bounds: THREE.Box3;
  mapSize?: number; // 2048 / 4096
}

/**
 * Настраивает физические тени на DirectionalLight. Можно передать уже существующий свет
 * (например, mainDirLightRef.current из App.tsx) — тогда новый не создаётся.
 */
export function configureSun(light: THREE.DirectionalLight, opts: SunOptions): THREE.DirectionalLight {
  const size = opts.mapSize ?? 4096;
  const dir = (opts.direction ?? new THREE.Vector3(0.5, 1, 0.4)).clone().normalize();

  light.castShadow = true;
  if (opts.color !== undefined) light.color.setHex(opts.color);
  if (opts.intensity !== undefined) light.intensity = opts.intensity;

  light.shadow.mapSize.set(size, size);
  light.shadow.bias = -0.0002; // убирает «акне» на поверхностях
  light.shadow.normalBias = 0.03; // сдвиг по нормали — убирает щели у стыков
  light.shadow.radius = 3; // мягкость края PCF

  // Подгоняем ортографическую камеру теней под габариты комнаты — максимум пикселей карты на метр
  const sphere = opts.bounds.getBoundingSphere(new THREE.Sphere());
  const cam = light.shadow.camera;
  cam.left = -sphere.radius;
  cam.right = sphere.radius;
  cam.top = sphere.radius;
  cam.bottom = -sphere.radius;
  cam.near = 0.1;
  cam.far = sphere.radius * 4;
  cam.updateProjectionMatrix();

  light.position.copy(sphere.center).addScaledVector(dir, sphere.radius * 2);
  light.target.position.copy(sphere.center);
  light.target.updateMatrixWorld();
  return light;
}

export function createSun(scene: THREE.Scene, opts: SunOptions): THREE.DirectionalLight {
  const sun = configureSun(new THREE.DirectionalLight(opts.color ?? 0xfff1d6, opts.intensity ?? 2.2), opts);
  scene.add(sun, sun.target);
  return sun;
}

/**
 * «Запекание» теней статической геометрии: карта теней считается один раз и больше не обновляется.
 * Экономит GPU, но динамические объекты (руки, переносимые предметы) тень отбрасывать не будут.
 * Вызывайте после загрузки комнаты; для повторного пересчёта — снова bakeStaticShadows().
 */
export function bakeStaticShadows(renderer: THREE.WebGLRenderer): void {
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;
}

// ============================================================================
// 5. БИБЛИОТЕКА PBR-МАТЕРИАЛОВ
// ============================================================================

/**
 * Правила PBR:
 *  • металл: metalness = 1 (0.0 или 1.0, промежуточные — только для окислов/грязи по маске);
 *  • металл БЕЗ окружения выглядит чёрным — нужен scene.environment (см. setupEnvironment);
 *  • диэлектрики (стены, пол, мебель): metalness = 0, roughness 0.5–0.95.
 */
export const MaterialPresets = {
  /** Полированный хром */
  chrome: () =>
    new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 1, roughness: 0.05, clearcoat: 0 }),

  /** Нержавеющая сталь перил (как на скриншоте): светлый, чуть размытый блик */
  stainlessRailing: () =>
    new THREE.MeshPhysicalMaterial({ color: 0xdfe3e8, metalness: 1, roughness: 0.18 }),

  /** Шлифованная сталь с растянутым бликом (anisotropy) */
  brushedSteel: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xc9ced4,
      metalness: 1,
      roughness: 0.38,
      anisotropy: 0.7,
      anisotropyRotation: 0
    }),

  /** Матовая штукатурка / окрашенная стена */
  matteWall: (color = 0xb7aa9a) =>
    new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.92 }),

  /** Бетон / ковролин пола */
  matteFloor: (color = 0x9b9690) =>
    new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.88 }),

  /** Лакированное дерево (мебель): плотная матовая основа + лаковый слой */
  varnishedWood: (color = 0x3a2a20) =>
    new THREE.MeshPhysicalMaterial({
      color,
      metalness: 0,
      roughness: 0.55,
      clearcoat: 0.6,
      clearcoatRoughness: 0.25
    }),

  /** Пластик приборов */
  plastic: (color = 0xd8d8d2) =>
    new THREE.MeshPhysicalMaterial({ color, metalness: 0, roughness: 0.42, clearcoat: 0.15, clearcoatRoughness: 0.4 }),

  rubber: (color = 0x1b1b1d) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.95 }),

  paper: (color = 0xe9e4d6) => new THREE.MeshStandardMaterial({ color, metalness: 0, roughness: 0.97 }),

  /** Стекло. transmission тяжёлый (доп. проход рендера) — не используйте на десятках объектов */
  glass: () =>
    new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0,
      roughness: 0.02,
      transmission: 1,
      thickness: 0.01,
      ior: 1.5
    })
} as const;

export type MaterialPresetId = keyof typeof MaterialPresets;

// ============================================================================
// 6. PBR-ТЕКСТУРЫ: Albedo / Normal / Roughness / Metalness / AO / Lightmap
// ============================================================================

export interface PBRTextureSet {
  albedo?: string; // sRGB
  normal?: string; // linear
  roughness?: string; // linear (канал G)
  metalness?: string; // linear (канал B)
  ao?: string; // linear (канал R)
  /** Упакованная карта ORM: R = AO, G = Roughness, B = Metalness (glTF-стандарт) */
  orm?: string;
  /** Запечённая карта освещения / GI (из Blender). 8-бит PNG — sRGB, EXR/HDR — linear */
  lightmap?: string;
  lightmapIsLinear?: boolean;
  repeat?: [number, number];
  /** Normal map из DirectX-пайплайна (Substance/Unreal) — зелёный канал инвертирован */
  normalDirectX?: boolean;
  normalScale?: number;
  aoIntensity?: number;
  /** Набор UV для aoMap/lightMap: 0 — основной, 1 — второй (если запекали на отдельной развёртке) */
  bakedUvChannel?: 0 | 1;
}

const textureCache = new Map<string, Promise<THREE.Texture>>();
const sharedLoader = new THREE.TextureLoader();

/**
 * Загрузка текстуры с ПРАВИЛЬНЫМ цветовым пространством.
 *  • Albedo/Emissive → SRGBColorSpace (данные хранят «цвет»)
 *  • Normal/Roughness/Metalness/AO/ORM → NoColorSpace (это числа, а не цвета; гамма-коррекция запрещена)
 */
export function loadTexture(
  url: string,
  renderer: THREE.WebGLRenderer,
  kind: 'color' | 'data',
  repeat?: [number, number]
): Promise<THREE.Texture> {
  const key = `${url}|${kind}|${repeat?.join(',') ?? ''}`;
  let p = textureCache.get(key);
  if (!p) {
    p = sharedLoader.loadAsync(url).then(tex => {
      tex.colorSpace = kind === 'color' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      if (repeat) tex.repeat.set(repeat[0], repeat[1]);
      tex.generateMipmaps = true;
      tex.minFilter = THREE.LinearMipmapLinearFilter; // трилинейная фильтрация
      return tex;
    });
    textureCache.set(key, p);
  }
  return p;
}

/** Создаёт MeshPhysicalMaterial из набора текстур. */
export async function createPBRMaterial(
  renderer: THREE.WebGLRenderer,
  set: PBRTextureSet,
  params: THREE.MeshPhysicalMaterialParameters = {}
): Promise<THREE.MeshPhysicalMaterial> {
  const mat = new THREE.MeshPhysicalMaterial({ metalness: 0, roughness: 1, ...params });
  const rep = set.repeat;
  const jobs: Array<Promise<void>> = [];

  if (set.albedo) jobs.push(loadTexture(set.albedo, renderer, 'color', rep).then(t => void (mat.map = t)));

  if (set.normal) {
    jobs.push(
      loadTexture(set.normal, renderer, 'data', rep).then(t => {
        mat.normalMap = t;
        const k = set.normalScale ?? 1;
        mat.normalScale.set(k, set.normalDirectX ? -k : k);
      })
    );
  }

  if (set.orm) {
    // Одна текстура на три карты: экономит память и обращения к сэмплеру
    jobs.push(
      loadTexture(set.orm, renderer, 'data', rep).then(t => {
        mat.aoMap = t;
        mat.roughnessMap = t;
        mat.metalnessMap = t;
        // Множители в 1: итог = значение из карты
        mat.roughness = 1;
        mat.metalness = 1;
      })
    );
  } else {
    if (set.roughness) jobs.push(loadTexture(set.roughness, renderer, 'data', rep).then(t => void (mat.roughnessMap = t)));
    if (set.metalness) {
      jobs.push(
        loadTexture(set.metalness, renderer, 'data', rep).then(t => {
          mat.metalnessMap = t;
          mat.metalness = 1;
        })
      );
    }
    if (set.ao) jobs.push(loadTexture(set.ao, renderer, 'data', rep).then(t => void (mat.aoMap = t)));
  }

  if (set.lightmap) {
    jobs.push(
      loadTexture(set.lightmap, renderer, set.lightmapIsLinear ? 'data' : 'color').then(t => {
        t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
        t.repeat.set(1, 1);
        t.channel = set.bakedUvChannel ?? 1; // лайтмапы почти всегда на втором UV (uv1)
        mat.lightMap = t;
        mat.lightMapIntensity = 1.0;
      })
    );
  }

  await Promise.all(jobs);

  if (mat.aoMap) {
    mat.aoMapIntensity = set.aoIntensity ?? 1.0;
    // aoMap по умолчанию читает основной UV (channel = 0). Если AO запечён на uv1:
    if (set.bakedUvChannel === 1) mat.aoMap.channel = 1;
  }
  mat.needsUpdate = true;
  return mat;
}

// ============================================================================
// 7. «АПГРЕЙД» УЖЕ ЗАГРУЖЕННОЙ СЦЕНЫ (GLB из Blender и т.п.)
// ============================================================================

export interface UpgradeOptions {
  castShadow?: boolean;
  receiveShadow?: boolean;
  /** Не включать тени для мешей, чьё имя совпадает (стекло, декали, лучи света) */
  skipShadowNameRegex?: RegExp;
}

/**
 * Обходит загруженную модель и:
 *  — включает cast/receive shadow;
 *  — выставляет анизотропию 16x на всех текстурах;
 *  — исправляет цветовое пространство (map/emissiveMap → sRGB, остальное → linear);
 *  — убирает «вечную чёрноту» металла: отражения берутся из scene.environment автоматически.
 */
export function upgradeSceneMaterials(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  opts: UpgradeOptions = {}
): void {
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const colorMaps = ['map', 'emissiveMap', 'specularColorMap', 'sheenColorMap'];
  const dataMaps = [
    'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap', 'bumpMap',
    'displacementMap', 'alphaMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap',
    'transmissionMap', 'thicknessMap'
  ];

  root.traverse(obj => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;

    const skip = opts.skipShadowNameRegex?.test(mesh.name) ?? false;
    mesh.castShadow = !skip && (opts.castShadow ?? true);
    mesh.receiveShadow = opts.receiveShadow ?? true;

    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of mats) {
      const rec = m as unknown as Record<string, unknown>;
      for (const k of colorMaps) {
        const t = rec[k] as THREE.Texture | null | undefined;
        if (t) {
          t.colorSpace = THREE.SRGBColorSpace;
          t.anisotropy = aniso;
        }
      }
      for (const k of dataMaps) {
        const t = rec[k] as THREE.Texture | null | undefined;
        if (t) {
          t.colorSpace = THREE.NoColorSpace;
          t.anisotropy = aniso;
        }
      }
      m.needsUpdate = true;
    }
  });
}
