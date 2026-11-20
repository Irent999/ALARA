/**
 * ALARA-Planner Pro — Кастомный GLSL-шейдер свечения Вавилова — Черенкова и ионизации воздуха
 * (src/shaders/CherenkovGlowShader.ts)
 *
 * Физическая основа:
 * 1. Излучение Вавилова — Черенкова возникает при движении релятивистских заряженных частиц
 *    (быстрых комптоновских/бета-электронов) со скоростью v > c / n, где n — показатель преломления среды.
 * 2. Спектральная плотность энергии описывается формулой Тамма — Франка:
 *      d²W / (dx · dω) = (q² / 4π) · ω · [1 - 1 / (β² · n²(ω))]
 *    что обуславливает максимум интенсивности в коротковолновой фиолетово-голубой области
 *    видимого спектра (λ ≈ 400–480 нм, характерный цвет #22d3ee / #38bdf8 / #60a5fa).
 * 3. В воздушной среде вблизи открытых высокоактивных источников (A > 10¹² Бк) дополнительно
 *    возникает флуоресценция ионизированных молекул азота N₂⁺ (полосы 391.4 нм и 427.8 нм).
 *
 * Оптимизировано под 90 FPS для стереоскопического рендеринга WebXR.
 */

import * as THREE from 'three';

// ============================================================================
// 1. ТИПИЗАЦИЯ ЮНИФОРМ И ПАРАМЕТРОВ ШЕЙДЕРА ВАВИЛОВА — ЧЕРЕНКОВА
// ============================================================================

export type CherenkovMediumType = 'water_pool' | 'heavy_water' | 'ionized_air' | 'lead_glass_tf5';

export interface CherenkovGlowUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  /** Текущее время симуляции t (с) для анимации FBM-шума и высокочастотной пульсации */
  uTime: THREE.IUniform<number>;
  /** Активность источника A в беккерелях (Бк) */
  uActivityBq: THREE.IUniform<number>;
  /** Логарифмически нормированный коэффициент активности log10(A / A_threshold) в диапазоне [0..1.5] */
  uNormalizedActivity: THREE.IUniform<number>;
  /** Показатель преломления среды n (вода: 1.333, воздух: 1.000293, стекло ТФ-5: 1.75) */
  uRefractiveIndex: THREE.IUniform<number>;
  /** Относительная скорость релятивистских бета/комптоновских электронов β = v / c (0.75 .. 0.995) */
  uRelativisticBeta: THREE.IUniform<number>;
  /** Длина волны пика излучения в нанометрах (400..480 нм) */
  uWavelengthNm: THREE.IUniform<number>;
  /** Основной коротковолновый цвет ядра (λ ~ 415 нм, глубокий черенковский сине-фиолетовый) */
  uCoreColor: THREE.IUniform<THREE.Color>;
  /** Внешний цвет короны ионизации (λ ~ 465 нм, голубой циан) */
  uRimColor: THREE.IUniform<THREE.Color>;
  /** Экспонента краевого эффекта Френеля (Fresnel Power) */
  uFresnelPower: THREE.IUniform<number>;
  /** Интенсивность фрактальной турбулентности ионизированного ореола (FBM Scale) */
  uNoiseScale: THREE.IUniform<number>;
  /** Частота высокочастотного квантового мерцания (Гц) */
  uPulseFrequencyHz: THREE.IUniform<number>;
  /** Общий множитель прозрачности ореола */
  uOpacity: THREE.IUniform<number>;
}

export interface CherenkovGlowMaterialOptions {
  /** Активность источника ионизирующего излучения A (Бк), по умолчанию 3.7e13 Бк (1000 Ки) */
  readonly activityBq?: number;
  /** Тип оптической среды или явный показатель преломления */
  readonly medium?: CherenkovMediumType;
  /** Явный показатель преломления среды n (переопределяет пресет medium) */
  readonly refractiveIndex?: number;
  /** Относительная скорость электронов β = v / c (по умолчанию 0.94) */
  readonly relativisticBeta?: number;
  /** Эффективная длина волны свечения в нм (400..480 нм, по умолчанию 445 нм) */
  readonly wavelengthNm?: number;
  /** Показатель степени эффекта Френеля на границах объекта (по умолчанию 2.6) */
  readonly fresnelPower?: number;
  /** Масштаб трехмерного симплекс-шума FBM (по умолчанию 3.4) */
  readonly noiseScale?: number;
  /** Частота высокочастотной пульсации ионизации (по умолчанию 18.0 Гц) */
  readonly pulseFrequencyHz?: number;
  /** Базовая непрозрачность (по умолчанию 0.88) */
  readonly opacity?: number;
  /** Использовать двухсторонний рендеринг для объемных оболочек */
  readonly doubleSided?: boolean;
}

export const CHERENKOV_MEDIUM_REFRACTIVE_INDEX: Readonly<Record<CherenkovMediumType, number>> = {
  water_pool: 1.333,
  heavy_water: 1.328,
  ionized_air: 1.000293,
  lead_glass_tf5: 1.755
};

// ============================================================================
// 2. ФИЗИЧЕСКИЕ ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ (СПЕКТР 400-480 НМ И ФАКТОР ТАММА-ФРАНКА)
// ============================================================================

/**
 * Преобразование длины волны видимого спектра λ ∈ [400..480] нм
 * в линейный RGB-цвет свечения Вавилова — Черенкова.
 */
export function wavelengthNmToCherenkovColor(wavelengthNm: number = 445): {
  coreColor: THREE.Color;
  rimColor: THREE.Color;
} {
  const wl = THREE.MathUtils.clamp(wavelengthNm, 400, 480);
  // Нормированный параметр t ∈ [0..1] от фиолетово-синего (400 нм) к бирюзово-голубому (480 нм)
  const t = (wl - 400) / 80;

  const coreColor = new THREE.Color().setHSL(
    THREE.MathUtils.lerp(0.62, 0.54, t),
    0.96,
    THREE.MathUtils.lerp(0.56, 0.64, t)
  );
  const rimColor = new THREE.Color().setHSL(
    THREE.MathUtils.lerp(0.56, 0.50, t),
    1.0,
    THREE.MathUtils.lerp(0.62, 0.72, t)
  );

  return { coreColor, rimColor };
}

/**
 * Вычисление логарифмически нормированной интенсивности свечения по активности A (Бк).
 * Порог визуального проявления ионизации/черенковского свечения принят равным 10⁹ Бк (1 ГБк),
 * насыщение — при 10¹⁵ Бк (1 ПБк, открытая ТВС реактора).
 */
export function computeNormalizedActivityFactor(activityBq: number): number {
  const safeBq = Math.max(1.0, Number.isFinite(activityBq) ? activityBq : 1e12);
  const logBq = Math.log10(safeBq);
  return THREE.MathUtils.clamp((logBq - 8.5) / 6.0, 0.05, 1.65);
}

// ============================================================================
// 3. ВЕРШИННЫЙ И ФРАГМЕНТНЫЙ GLSL-ШЕЙДЕРЫ (SIMPLEX NOISE + FBM + ТАММ-ФРАНК + FRESNEL)
// ============================================================================

export const CHERENKOV_VERTEX_SHADER = /* glsl */ `
  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uNormalizedActivity;
  uniform float uNoiseScale;

  void main() {
    vUv = uv;
    vLocalPosition = position;

    // Микро-осцилляция оболочки ионизированного газа вдоль нормали
    float microDisplacement = sin(position.y * 14.0 + uTime * 9.0)
                            * cos(position.x * 11.0 - uTime * 7.0)
                            * 0.006 * uNormalizedActivity;

    vec3 displacedPosition = position + normal * microDisplacement;

    vec4 worldPos = modelMatrix * vec4(displacedPosition, 1.0);
    vWorldPosition = worldPos.xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * normal);
    vViewDirection = normalize(cameraPosition - worldPos.xyz);

    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

export const CHERENKOV_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPosition;
  varying vec3 vWorldNormal;
  varying vec3 vViewDirection;
  varying vec3 vLocalPosition;
  varying vec2 vUv;

  uniform float uTime;
  uniform float uActivityBq;
  uniform float uNormalizedActivity;
  uniform float uRefractiveIndex;
  uniform float uRelativisticBeta;
  uniform float uWavelengthNm;
  uniform vec3 uCoreColor;
  uniform vec3 uRimColor;
  uniform float uFresnelPower;
  uniform float uNoiseScale;
  uniform float uPulseFrequencyHz;
  uniform float uOpacity;

  // --- Быстрый 3D Simplex Noise (оптимизирован без ветвлений для 90 FPS VR) ---
  vec4 permute(vec4 x) {
    return mod(((x * 34.0) + 1.0) * x, 289.0);
  }

  vec4 taylorInvSqrt(vec4 r) {
    return 1.79284291400159 - 0.85373472095314 * r;
  }

  float snoise3D(vec3 v) {
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod(i, 289.0);
    vec4 p = permute(
      permute(
        permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0)
      )
      + i.x + vec4(0.0, i1.x, i2.x, 1.0)
    );

    float n_ = 1.0 / 7.0;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x;
    p1 *= norm.y;
    p2 *= norm.z;
    p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }

  // --- 3-октавный фрактальный броуновский шум (FBM) для конвекции ионизированной среды ---
  float fbmIonization(vec3 p) {
    float value = 0.0;
    float amplitude = 0.55;
    float frequency = 1.0;
    for (int i = 0; i < 3; i++) {
      value += amplitude * (0.5 + 0.5 * snoise3D(p * frequency));
      frequency *= 2.12;
      amplitude *= 0.48;
    }
    return value;
  }

  void main() {
    vec3 N = normalize(vWorldNormal);
    vec3 V = normalize(vViewDirection);

    // 1. Краевой эффект Френеля (Fresnel Rim) + внутреннее объемное ядро
    float NdotV = abs(dot(N, V));
    float fresnelRim = pow(clamp(1.0 - NdotV, 0.0, 1.0), uFresnelPower);
    float innerCore = pow(NdotV, 1.65);

    // 2. Релятивистский фактор Тамма — Франка: F_TF = max(0, 1 - 1 / (beta^2 * n^2))
    //    Для ионизированного воздуха (n ~ 1.000293) добавляется базовый вклад свечения азота N2+
    float betaN = uRelativisticBeta * uRefractiveIndex;
    float frankTammFactor = betaN > 1.0
      ? clamp(1.0 - 1.0 / (betaN * betaN), 0.18, 1.0)
      : 0.24; // Коронная люминесценция ионизированного воздуха (391-428 нм)

    // 3. Фрактальное поле FBM с восходящим конвективным дрейфом вдоль оси Y
    vec3 noiseCoord = vLocalPosition * uNoiseScale + vec3(
      sin(uTime * 0.7) * 0.25,
      -uTime * 1.35,
      cos(uTime * 0.6) * 0.25
    );
    float fbmVal = fbmIonization(noiseCoord);

    // 4. Высокочастотная пульсация квантовых каскадов (зависит от активности Bq)
    float hfPulse1 = sin(uTime * uPulseFrequencyHz * 6.2831853 + fbmVal * 6.0);
    float hfPulse2 = cos(uTime * (uPulseFrequencyHz * 1.73) * 6.2831853 - vLocalPosition.y * 18.0);
    float scintillation = 0.86 + 0.14 * (0.6 * hfPulse1 + 0.4 * hfPulse2);

    // 5. Спектральный сдвиг по длине волны 400..480 нм (дисперсия ~ 1 / lambda^3)
    float wavelengthFactor = pow(445.0 / clamp(uWavelengthNm, 400.0, 480.0), 2.2);

    // 6. Итоговая энергетическая яркость свечения
    float activityGain = clamp(uNormalizedActivity, 0.1, 1.8) * (0.75 + 1.15 * frankTammFactor);
    float spatialProfile = mix(innerCore * 0.68, 1.25, fresnelRim) * (0.65 + 0.55 * fbmVal);
    float totalIntensity = activityGain * spatialProfile * scintillation * wavelengthFactor;

    // Смешивание глубокого черенковского синего ядра (415 нм) и яркой голубой короны Френеля (470 нм)
    vec3 spectralColor = mix(uCoreColor, uRimColor, clamp(fresnelRim * 1.15 + fbmVal * 0.25, 0.0, 1.0));
    // Вспышки бело-голубой ионизации на пиках FBM при сверхвысокой активности
    vec3 hotIonizationPeak = vec3(0.82, 0.96, 1.0) * pow(fbmVal, 3.0) * uNormalizedActivity * 0.55;

    vec3 finalColor = spectralColor * totalIntensity + hotIonizationPeak;
    float finalAlpha = clamp(
      uOpacity * (innerCore * 0.38 + fresnelRim * 0.85) * (0.55 + 0.45 * fbmVal) * clamp(uNormalizedActivity, 0.2, 1.3),
      0.0,
      0.95
    );

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

// ============================================================================
// 4. КЛАСС КАСТОМНОГО МАТЕРИАЛА И 3D-КОНТРОЛЛЕР СВЕЧЕНИЯ ВАВИЛОВА — ЧЕРЕНКОВА
// ============================================================================

export class CherenkovGlowShaderMaterial extends THREE.ShaderMaterial {
  declare public uniforms: CherenkovGlowUniforms;

  constructor(options: CherenkovGlowMaterialOptions = {}) {
    const activityBq = options.activityBq ?? 3.7e13;
    const medium: CherenkovMediumType = options.medium ?? 'water_pool';
    const refractiveIndex =
      options.refractiveIndex ?? CHERENKOV_MEDIUM_REFRACTIVE_INDEX[medium];
    const relativisticBeta = options.relativisticBeta ?? 0.94;
    const wavelengthNm = options.wavelengthNm ?? 445;
    const { coreColor, rimColor } = wavelengthNmToCherenkovColor(wavelengthNm);

    const uniforms: CherenkovGlowUniforms = {
      uTime: { value: 0.0 },
      uActivityBq: { value: activityBq },
      uNormalizedActivity: { value: computeNormalizedActivityFactor(activityBq) },
      uRefractiveIndex: { value: refractiveIndex },
      uRelativisticBeta: { value: relativisticBeta },
      uWavelengthNm: { value: wavelengthNm },
      uCoreColor: { value: coreColor },
      uRimColor: { value: rimColor },
      uFresnelPower: { value: options.fresnelPower ?? 2.4 },
      uNoiseScale: { value: options.noiseScale ?? 3.2 },
      uPulseFrequencyHz: { value: options.pulseFrequencyHz ?? 16.0 },
      uOpacity: { value: options.opacity ?? 0.86 }
    };

    super({
      name: 'CherenkovGlowShaderMaterial',
      uniforms,
      vertexShader: CHERENKOV_VERTEX_SHADER,
      fragmentShader: CHERENKOV_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: options.doubleSided !== false ? THREE.DoubleSide : THREE.FrontSide
    });
  }

  /**
   * Обновление времени шейдера и динамической активности источника в цикле рендеринга (90 FPS)
   */
  public update(deltaTimeSeconds: number, currentActivityBq?: number): void {
    this.uniforms.uTime.value += deltaTimeSeconds;
    if (typeof currentActivityBq === 'number' && Number.isFinite(currentActivityBq)) {
      this.uniforms.uActivityBq.value = currentActivityBq;
      this.uniforms.uNormalizedActivity.value = computeNormalizedActivityFactor(currentActivityBq);
    }
  }

  /**
   * Изменение оптической среды (например, при извлечении ТВС из воды бассейна выдержки в воздух)
   */
  public setMedium(medium: CherenkovMediumType, customRefractiveIndex?: number): void {
    this.uniforms.uRefractiveIndex.value =
      customRefractiveIndex ?? CHERENKOV_MEDIUM_REFRACTIVE_INDEX[medium];
  }
}

/**
 * Создает двухслойный 3D-узел свечения Вавилова — Черенкова (внутреннее ядро + внешняя Френель-корона
 * + динамический точечный источник света 445 нм) с авто-обновлением через `onBeforeRender`.
 */
export function createCherenkovShaderMeshGroup(
  radiusMeters: number = 0.85,
  options: CherenkovGlowMaterialOptions = {}
): THREE.Group {
  const group = new THREE.Group();
  group.name = 'cherenkov_vavilov_shader_group';

  const coreMaterial = new CherenkovGlowShaderMaterial({
    ...options,
    wavelengthNm: options.wavelengthNm ?? 425,
    fresnelPower: 1.75,
    noiseScale: 4.2,
    opacity: 0.92,
    doubleSided: false
  });

  const outerCoronaMaterial = new CherenkovGlowShaderMaterial({
    ...options,
    wavelengthNm: options.wavelengthNm ?? 462,
    fresnelPower: 2.9,
    noiseScale: 2.6,
    opacity: 0.68,
    doubleSided: true
  });

  const coreGeo = new THREE.SphereGeometry(radiusMeters * 0.46, 32, 24);
  const coreMesh = new THREE.Mesh(coreGeo, coreMaterial);
  coreMesh.name = 'cherenkov_inner_core_mesh';
  coreMesh.raycast = () => {};

  const outerGeo = new THREE.SphereGeometry(radiusMeters, 36, 28);
  const outerMesh = new THREE.Mesh(outerGeo, outerCoronaMaterial);
  outerMesh.name = 'cherenkov_outer_fresnel_corona';
  outerMesh.raycast = () => {};

  const cherenkovLight = new THREE.PointLight(0x38bdf8, 2.4, radiusMeters * 5.5, 2.0);
  cherenkovLight.position.set(0, 0.12, 0);

  // Автоматическое обновление юниформ uTime непосредственно перед отрисовкой кадра в WebGL / WebXR
  let lastRenderTimeMs = performance.now();
  coreMesh.onBeforeRender = () => {
    const nowMs = performance.now();
    const dt = Math.min(0.1, Math.max(0.0, (nowMs - lastRenderTimeMs) / 1000.0));
    lastRenderTimeMs = nowMs;

    coreMaterial.update(dt);
    outerCoronaMaterial.update(dt);

    // Высокочастотная микро-пульсация локального освещения вокруг источника
    const t = coreMaterial.uniforms.uTime.value;
    const normAct = coreMaterial.uniforms.uNormalizedActivity.value;
    cherenkovLight.intensity = (2.0 + 0.28 * Math.sin(t * 24.0) + 0.15 * Math.cos(t * 37.0)) * normAct;
  };

  group.add(coreMesh);
  group.add(outerMesh);
  group.add(cherenkovLight);

  group.userData = {
    isCherenkovShaderGroup: true,
    coreMaterial,
    outerCoronaMaterial,
    cherenkovLight
  };

  return group;
}
