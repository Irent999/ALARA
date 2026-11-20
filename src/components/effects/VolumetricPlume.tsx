/**
 * ALARA-Planner Pro — Объемное радиоактивное аэрозольное облако по Гауссовой модели
 * Паскуилла — Гиффорда с оптическим эффектом Тиндаля (src/components/effects/VolumetricPlume.tsx)
 *
 * Физико-математическая модель:
 * 1. Дисперсия шлейфа вдоль оси ветра X подчиняется модели Паскуилла — Гиффорда:
 *      σ_y(x) = a_y · x^{b_y},   σ_z(x) = a_z · x^{b_z}
 *    Концентрация аэрозоля убывает по гауссиане поперек потока (ось Z) и по высоте (ось Y)
 *    с зеркальным отражением от подстилающей поверхности (z = 0).
 * 2. Оптический эффект Тиндаля (Tyndall / Mie Scattering):
 *    При прохождении луча тактического фонаря с левого контроллера (THREE.SpotLight, 5500K, 30°)
 *    сквозь аэрозольное облако в шейдере вычисляется угловое перекрытие с конусом прожектора,
 *    затухание по закону обратных квадратов 1/d² и фазовая функция рассеяния Хеньи — Гринштейна
 *    P(θ) = (1 - g²) / [4π · (1 + g² - 2g·cos(θ))^{3/2}], создавая яркий световой столб в дыму.
 *
 * Вся адвекция частиц и расчет рассеяния выполняются на GPU в вершинном и фрагментном шейдерах
 * для гарантированных 90 FPS в стерео-режиме WebXR.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { PasquillStabilityClass } from '../../physics/gostPhysics';

// ============================================================================
// 1. ТИПИЗАЦИЯ ЮНИФОРМ И ПАРАМЕТРОВ ГАУССОВА ПЛЮМА ПАСКУИЛЛА — ГИФФОРДА
// ============================================================================

export interface VolumetricPlumeUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  /** Текущее время симуляции (с) для непрерывной ветровой адвекции на GPU */
  uTime: THREE.IUniform<number>;
  /** Скорость ветра вдоль локальной оси +X шлейфа (м/с) */
  uWindSpeedMps: THREE.IUniform<number>;
  /** Максимальная протяженность визуализируемого шлейфа по ветру X_max (м) */
  uPlumeLengthM: THREE.IUniform<number>;
  /** Эффективная высота устья выброса H_eff (м) */
  uReleaseHeightM: THREE.IUniform<number>;
  /** Коэффициенты дисперсии Паскуилла — Гиффорда (a_y, b_y, a_z, b_z) */
  uPasquillCoeffs: THREE.IUniform<THREE.Vector4>;
  /** Базовый цвет радиоактивного пара / пылевого аэрозоля */
  uBaseAerosolColor: THREE.IUniform<THREE.Color>;
  /** Цвет рассеянного света Тиндаля от тактического фонаря 5500K */
  uTyndallLightColor: THREE.IUniform<THREE.Color>;
  /** Позиция тактического фонаря левой руки в мировых координатах */
  uFlashlightWorldPos: THREE.IUniform<THREE.Vector3>;
  /** Единичный вектор направления луча фонаря левой руки в мировых координатах */
  uFlashlightWorldDir: THREE.IUniform<THREE.Vector3>;
  /** Косинус внешнего угла полураствора конуса фонаря cos(angle) */
  uFlashlightCosOuter: THREE.IUniform<number>;
  /** Косинус внутреннего угла ядра конуса фонаря cos(angle * (1 - penumbra)) */
  uFlashlightCosInner: THREE.IUniform<number>;
  /** Интенсивность включенного фонаря (0.0 если выключен) */
  uFlashlightIntensity: THREE.IUniform<number>;
  /** Коэффициент асимметрии индикатрисы рассеяния Ми / Хеньи — Гринштейна g ∈ [0.5..0.85] */
  uMieAnisotropyG: THREE.IUniform<number>;
  /** Базовая оптическая плотность аэрозоля */
  uBaseOpacity: THREE.IUniform<number>;
}

export interface VolumetricPlumeOptions {
  /** Количество GPU-частиц аэрозоля (по умолчанию 420, оптимизировано для 90 FPS VR) */
  readonly particleCount?: number;
  /** Класс устойчивости атмосферы по Паскуиллу (A..F), по умолчанию 'D' */
  readonly stabilityClass?: PasquillStabilityClass;
  /** Скорость переноса шлейфа ветром (м/с), по умолчанию 1.8 м/с */
  readonly windSpeedMps?: number;
  /** Длина распространения облака вдоль оси X (м), по умолчанию 6.5 м */
  readonly plumeLengthM?: number;
  /** Высота источника выброса над полом (м), по умолчанию 0.65 м */
  readonly releaseHeightM?: number;
  /** Азимут направления ветра в горизонтальной плоскости XZ (рад), по умолчанию 0 */
  readonly windDirectionRad?: number;
  /** Базовый цвет аэрозоля (по умолчанию сизо-серый радиоактивный пар 0x94a3b8) */
  readonly aerosolColorHex?: number;
  /** Базовая непрозрачность клубов аэрозоля (по умолчанию 0.26) */
  readonly baseOpacity?: number;
}

const PASQUILL_SHADER_COEFFS: Readonly<
  Record<PasquillStabilityClass, [number, number, number, number]>
> = {
  A: [0.36, 0.86, 0.28, 0.86],
  B: [0.28, 0.86, 0.22, 0.85],
  C: [0.22, 0.85, 0.17, 0.83],
  D: [0.18, 0.84, 0.14, 0.80],
  E: [0.14, 0.83, 0.10, 0.76],
  F: [0.11, 0.82, 0.08, 0.72]
};

// ============================================================================
// 2. GLSL ШЕЙДЕРЫ ГАУССОВА ПЛЮМА И ОПТИЧЕСКОГО РАССЕЯНИЯ ТИНДАЛЯ
// ============================================================================

const VOLUMETRIC_PLUME_VERTEX_SHADER = /* glsl */ `
  attribute vec3 aSeed; // x: начальная фаза вдоль ветра [0..1], y: гауссово откл. Y [-2.5..2.5], z: гауссово откл. Z [-2.5..2.5]
  attribute float aPointScale;

  varying vec3 vWorldPos;
  varying float vNormalizedDownwind;
  varying float vGaussianWeight;
  varying float vTurbulencePhase;

  uniform float uTime;
  uniform float uWindSpeedMps;
  uniform float uPlumeLengthM;
  uniform float uReleaseHeightM;
  uniform vec4 uPasquillCoeffs; // x: a_y, y: b_y, z: a_z, w: b_z

  void main() {
    // 1. Непрерывная циклическая адвекция клубов аэрозоля по оси ветра +X
    float travelProgress = fract(aSeed.x + (uTime * uWindSpeedMps) / max(0.5, uPlumeLengthM));
    vNormalizedDownwind = travelProgress;

    float downwindX = travelProgress * uPlumeLengthM;

    // 2. Расчет дисперсий Паскуилла — Гиффорда sigma_y(x) и sigma_z(x) по мере удаления от источника
    float xEff = max(0.25, downwindX + 0.35);
    float sigmaY = uPasquillCoeffs.x * pow(xEff, uPasquillCoeffs.y);
    float sigmaZ = uPasquillCoeffs.z * pow(xEff, uPasquillCoeffs.w);

    // Турбулентный вихревой снос клубов дыма
    float swirlY = sin(uTime * 1.4 + aSeed.x * 19.0) * 0.12 * sigmaZ;
    float swirlZ = cos(uTime * 1.1 + aSeed.y * 15.0) * 0.15 * sigmaY;

    // Поперечное (ось Z в Three.js) и вертикальное (ось Y в Three.js) расширение гауссова факела
    float localZ = aSeed.z * sigmaY + swirlZ;
    float rawY = uReleaseHeightM + aSeed.y * sigmaZ + swirlY + 0.18 * travelProgress;
    // Отражение аэрозольного облака от пола (z_ground >= 0.08 м)
    float localY = max(0.08, abs(rawY));

    // Оценка гауссовой плотности концентрации в центре клубка: exp(-(y^2)/(2*sigma_y^2) - (z^2)/(2*sigma_z^2))
    float rNormSq = 0.5 * (aSeed.y * aSeed.y + aSeed.z * aSeed.z);
    float axialDilution = 1.0 / (1.0 + 1.35 * travelProgress);
    vGaussianWeight = exp(-0.42 * rNormSq) * axialDilution;
    vTurbulencePhase = aSeed.x * 31.4159 + uTime * 0.85;

    vec3 displacedLocalPos = vec3(downwindX, localY, localZ);
    vec4 worldPosition = modelMatrix * vec4(displacedLocalPos, 1.0);
    vWorldPos = worldPosition.xyz;

    vec4 mvPosition = viewMatrix * worldPosition;
    gl_Position = projectionMatrix * mvPosition;

    // Размер клуба аэрозоля растет пропорционально дисперсии Паскуилла sigma_y(x)
    float plumeExpansionSize = aPointScale * (0.55 + 1.45 * sigmaY);
    gl_PointSize = clamp((plumeExpansionSize * 340.0) / max(0.4, -mvPosition.z), 8.0, 160.0);
  }
`;

const VOLUMETRIC_PLUME_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec3 vWorldPos;
  varying float vNormalizedDownwind;
  varying float vGaussianWeight;
  varying float vTurbulencePhase;

  uniform vec3 uBaseAerosolColor;
  uniform vec3 uTyndallLightColor;
  uniform vec3 uFlashlightWorldPos;
  uniform vec3 uFlashlightWorldDir;
  uniform float uFlashlightCosOuter;
  uniform float uFlashlightCosInner;
  uniform float uFlashlightIntensity;
  uniform float uMieAnisotropyG;
  uniform float uBaseOpacity;

  void main() {
    // 1. Формирование мягкого объемного клуба дыма внутри Point-спрайта с вихревой краевой модуляцией
    vec2 centeredUv = gl_PointCoord * 2.0 - 1.0;
    float distSq = dot(centeredUv, centeredUv);
    if (distSq > 1.0) discard;

    float angle = atan(centeredUv.y, centeredUv.x);
    float billowNoise = 0.85 + 0.15 * sin(angle * 4.0 + vTurbulencePhase)
                             * cos(distSq * 5.0 - vTurbulencePhase);
    float radialSoftness = pow(clamp(1.0 - distSq, 0.0, 1.0), 1.75) * billowNoise;

    // Плавное появление у устья выброса и растворение на дальнем хвосте плюма
    float lifecycleFade = smoothstep(0.0, 0.08, vNormalizedDownwind)
                        * (1.0 - smoothstep(0.78, 1.0, vNormalizedDownwind));

    // 2. Расчет эффекта Тиндаля (Tyndall Effect) при пересечении с конусом тактического фонаря левой руки
    float tyndallScattering = 0.0;
    if (uFlashlightIntensity > 0.01) {
      vec3 lightToParticle = vWorldPos - uFlashlightWorldPos;
      float distToLight = length(lightToParticle);
      vec3 L = lightToParticle / max(0.001, distToLight);

      // Проекция на ось луча SpotLight
      float cosThetaSpot = dot(L, normalize(uFlashlightWorldDir));
      if (cosThetaSpot > uFlashlightCosOuter) {
        // Плавный профиль конуса с учетом полутени penumbra
        float spotConeAtten = smoothstep(uFlashlightCosOuter, uFlashlightCosInner, cosThetaSpot);
        // Закон обратных квадратов 1/r^2
        float distanceAtten = 1.0 / (1.0 + 0.14 * distToLight + 0.06 * distToLight * distToLight);

        // Индикатриса рассеяния Ми / Хеньи — Гринштейна для аэрозольных микрокапель
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float cosScatterAngle = dot(L, -viewDir);
        float g = clamp(uMieAnisotropyG, 0.0, 0.92);
        float g2 = g * g;
        float hgDenom = pow(max(0.05, 1.0 + g2 - 2.0 * g * cosScatterAngle), 1.5);
        float phaseMie = (1.0 - g2) / (4.0 * 3.14159265 * hgDenom);

        tyndallScattering = uFlashlightIntensity * spotConeAtten * distanceAtten * (0.65 + 1.85 * phaseMie);
      }
    }

    // 3. Итоговый цвет и прозрачность с учетом подсветки Тиндаля
    vec3 pseudoNormal = vec3(centeredUv.x, -centeredUv.y, sqrt(max(0.0, 1.0 - distSq)));
    float ambientTopShade = 0.72 + 0.28 * pseudoNormal.y;

    vec3 finalColor = uBaseAerosolColor * ambientTopShade
                    + uTyndallLightColor * clamp(tyndallScattering, 0.0, 3.2);

    // В луче тактического фонаря оптическая заметность взвешенных частиц возрастает (эффект Тиндаля)
    float tyndallAlphaBoost = 1.0 + clamp(tyndallScattering * 0.85, 0.0, 1.8);
    float finalAlpha = clamp(
      uBaseOpacity * radialSoftness * vGaussianWeight * lifecycleFade * tyndallAlphaBoost,
      0.0,
      0.88
    );

    gl_FragColor = vec4(finalColor, finalAlpha);
  }
`;

// ============================================================================
// 3. КЛАСС THREE.JS СИСТЕМЫ ГАУССОВА ПЛЮМА С АВТО-ПОИСКОМ ЛЕВОГО ФОНАРЯ
// ============================================================================

export class VolumetricPlumeSystem {
  public readonly rootGroup: THREE.Group;
  public readonly pointsMesh: THREE.Points;
  public readonly material: THREE.ShaderMaterial;
  public readonly uniforms: VolumetricPlumeUniforms;

  private readonly tempLightPos = new THREE.Vector3();
  private readonly tempTargetPos = new THREE.Vector3();
  private readonly tempLightDir = new THREE.Vector3(0, 0, -1);

  constructor(options: VolumetricPlumeOptions = {}) {
    const particleCount = options.particleCount ?? 420;
    const stability: PasquillStabilityClass = options.stabilityClass ?? 'D';
    const coeffs = PASQUILL_SHADER_COEFFS[stability] ?? PASQUILL_SHADER_COEFFS.D;
    const windSpeedMps = options.windSpeedMps ?? 1.8;
    const plumeLengthM = options.plumeLengthM ?? 6.5;
    const releaseHeightM = options.releaseHeightM ?? 0.45;
    const baseOpacity = options.baseOpacity ?? 0.26;

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'pasquill_gifford_volumetric_plume';
    if (typeof options.windDirectionRad === 'number') {
      this.rootGroup.rotation.y = options.windDirectionRad;
    }

    const outerAngleRad = Math.PI / 6; // 30°
    const penumbra = 0.4;
    const innerAngleRad = outerAngleRad * (1.0 - penumbra);

    this.uniforms = {
      uTime: { value: 0.0 },
      uWindSpeedMps: { value: windSpeedMps },
      uPlumeLengthM: { value: plumeLengthM },
      uReleaseHeightM: { value: releaseHeightM },
      uPasquillCoeffs: {
        value: new THREE.Vector4(coeffs[0], coeffs[1], coeffs[2], coeffs[3])
      },
      uBaseAerosolColor: {
        value: new THREE.Color(options.aerosolColorHex ?? 0x94a3b8)
      },
      uTyndallLightColor: {
        value: new THREE.Color(0xfff6e5) // 5500K тактический светодиод
      },
      uFlashlightWorldPos: { value: new THREE.Vector3(0, 1.5, 2) },
      uFlashlightWorldDir: { value: new THREE.Vector3(0, 0, -1) },
      uFlashlightCosOuter: { value: Math.cos(outerAngleRad) },
      uFlashlightCosInner: { value: Math.cos(innerAngleRad) },
      uFlashlightIntensity: { value: 0.0 },
      uMieAnisotropyG: { value: 0.72 },
      uBaseOpacity: { value: baseOpacity }
    };

    // Генерация детерминированного гауссова распределения (преобразование Бокса — Мюллера)
    const positions = new Float32Array(particleCount * 3);
    const seeds = new Float32Array(particleCount * 3);
    const pointScales = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      const u1 = Math.max(1e-4, ((i * 73 + 19) % 997) / 997);
      const u2 = ((i * 151 + 43) % 991) / 991;
      const u3 = Math.max(1e-4, ((i * 223 + 67) % 983) / 983);
      const u4 = ((i * 311 + 11) % 977) / 977;

      // Нормально распределенные координаты N(0, 1) по осям Y и Z
      const gaussY = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
      const gaussZ = Math.sqrt(-2.0 * Math.log(u3)) * Math.sin(2.0 * Math.PI * u4);

      const phaseX = i / particleCount;
      seeds[i * 3 + 0] = phaseX;
      seeds[i * 3 + 1] = THREE.MathUtils.clamp(gaussY, -2.4, 2.4);
      seeds[i * 3 + 2] = THREE.MathUtils.clamp(gaussZ, -2.4, 2.4);

      positions[i * 3 + 0] = phaseX * plumeLengthM;
      positions[i * 3 + 1] = releaseHeightM;
      positions[i * 3 + 2] = 0;

      pointScales[i] = 0.75 + (i % 7) * 0.14;
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
    geometry.setAttribute('aPointScale', new THREE.BufferAttribute(pointScales, 1));
    // Расширенная сфера отсечения, чтобы GPU-смещаемые партиклы не отсекались Frustum Culling'ом
    geometry.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(plumeLengthM * 0.5, 1.5, 0),
      plumeLengthM * 1.25
    );

    this.material = new THREE.ShaderMaterial({
      name: 'PasquillGiffordTyndallPlumeMaterial',
      uniforms: this.uniforms,
      vertexShader: VOLUMETRIC_PLUME_VERTEX_SHADER,
      fragmentShader: VOLUMETRIC_PLUME_FRAGMENT_SHADER,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });

    this.pointsMesh = new THREE.Points(geometry, this.material);
    this.pointsMesh.frustumCulled = false;
    this.pointsMesh.raycast = () => {};

    // Автоматическая синхронизация с лучом тактического фонаря левой руки в каждом кадре
    let lastTimeMs = performance.now();
    this.pointsMesh.onBeforeRender = (_renderer, scene) => {
      const nowMs = performance.now();
      const dt = Math.min(0.1, Math.max(0.0, (nowMs - lastTimeMs) / 1000.0));
      lastTimeMs = nowMs;

      this.uniforms.uTime.value += dt;
      this.syncWithSceneFlashlight(scene);
    };

    this.rootGroup.add(this.pointsMesh);
  }

  /**
   * Находит в графе сцены активный SpotLight тактического фонаря левой руки
   * и передает его мировую позицию, вектор луча и угол конуса в GLSL-юниформы Тиндаля.
   */
  public syncWithSceneFlashlight(scene: THREE.Scene, explicitSpotLight?: THREE.SpotLight | null): void {
    let activeSpot: THREE.SpotLight | null = explicitSpotLight ?? null;

    if (!activeSpot) {
      scene.traverse(obj => {
        if (
          !activeSpot &&
          (obj as THREE.SpotLight).isSpotLight &&
          (obj.name === 'flashlight_spot_light' ||
            obj.parent?.name === 'left_controller_tactical_flashlight_rig')
        ) {
          const candidate = obj as THREE.SpotLight;
          if (candidate.visible && candidate.intensity > 0.05) {
            activeSpot = candidate;
          }
        }
      });
    }

    if (activeSpot && activeSpot.visible && activeSpot.intensity > 0.05) {
      activeSpot.getWorldPosition(this.tempLightPos);
      activeSpot.target.getWorldPosition(this.tempTargetPos);
      this.tempLightDir.subVectors(this.tempTargetPos, this.tempLightPos).normalize();

      const outerAngle = activeSpot.angle;
      const innerAngle = outerAngle * (1.0 - activeSpot.penumbra);

      this.uniforms.uFlashlightWorldPos.value.copy(this.tempLightPos);
      this.uniforms.uFlashlightWorldDir.value.copy(this.tempLightDir);
      this.uniforms.uFlashlightCosOuter.value = Math.cos(outerAngle);
      this.uniforms.uFlashlightCosInner.value = Math.cos(innerAngle);
      this.uniforms.uFlashlightIntensity.value = activeSpot.intensity;
    } else {
      this.uniforms.uFlashlightIntensity.value = 0.0;
    }
  }

  public dispose(): void {
    this.pointsMesh.geometry.dispose();
    this.material.dispose();
  }
}

// ============================================================================
// 4. REACT-КОМПОНЕНТ VolumetricPlume ДЛЯ ИНТЕГРАЦИИ В THREE.JS / R3F СЦЕНУ
// ============================================================================

export interface VolumetricPlumeProps extends VolumetricPlumeOptions {
  /** Родительская Three.js сцена или группа, в которую монтируется облако */
  readonly parentGroup?: THREE.Object3D | null;
  /** Мировая позиция эпицентра выброса [x, y, z] */
  readonly position?: readonly [number, number, number];
  /** Ссылка на SpotLight тактического фонаря левого контроллера */
  readonly leftFlashlightSpotLight?: THREE.SpotLight | null;
}

export const VolumetricPlume: React.FC<VolumetricPlumeProps> = ({
  parentGroup,
  position = [0, 0, 0],
  leftFlashlightSpotLight,
  ...plumeOptions
}) => {
  const systemRef = useRef<VolumetricPlumeSystem | null>(null);

  useEffect(() => {
    const plumeSystem = new VolumetricPlumeSystem(plumeOptions);
    plumeSystem.rootGroup.position.set(position[0], position[1], position[2]);
    systemRef.current = plumeSystem;

    if (parentGroup) {
      parentGroup.add(plumeSystem.rootGroup);
    }

    return () => {
      if (parentGroup) {
        parentGroup.remove(plumeSystem.rootGroup);
      }
      plumeSystem.dispose();
      systemRef.current = null;
    };
  }, [
    parentGroup,
    position[0],
    position[1],
    position[2],
    plumeOptions.particleCount,
    plumeOptions.stabilityClass,
    plumeOptions.windSpeedMps,
    plumeOptions.plumeLengthM,
    plumeOptions.releaseHeightM,
    plumeOptions.windDirectionRad,
    plumeOptions.aerosolColorHex,
    plumeOptions.baseOpacity
  ]);

  useEffect(() => {
    if (systemRef.current && leftFlashlightSpotLight && parentGroup) {
      let rootScene: THREE.Object3D = parentGroup;
      while (rootScene.parent) {
        rootScene = rootScene.parent;
      }
      if ((rootScene as THREE.Scene).isScene) {
        systemRef.current.syncWithSceneFlashlight(
          rootScene as THREE.Scene,
          leftFlashlightSpotLight
        );
      }
    }
  }, [leftFlashlightSpotLight, parentGroup]);

  return null;
};
