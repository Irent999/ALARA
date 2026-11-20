/**
 * ALARA-Planner Pro — Кастомный пост-эффект панорамной маски противогаза / скафандра РХБЗ
 * и радиационной ионизации матрицы (src/shaders/VisorPostProcessing.tsx)
 *
 * Реализует 4 физических оптических и радиационных эффекта для VR (90 FPS Stereo) и Desktop:
 * а) Внутренние поликарбонатные блики и сферическая дисторсия стекла маски (Visor Distortion).
 * б) Запотевание внутренней поверхности забрала по краям (Breath Condensation Fog),
 *    пульсирующее в такт дыханию и усиливающееся при росте пульса / физической нагрузки (BPM).
 * в) Радиационный шум сенсора (Cherenkov / Radiation CMOS Noise) — белые статические точки
 *    выбитых комптоновских электронов, мерцание и строчные микро-глитчи при МЭД > 10 мЗв/ч.
 * г) Автоматическая адаптация глаза (HDR Exposure Adaptation) при наведении тактического фонаря
 *    на темные аварийные участки.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ============================================================================
// 1. ТИПИЗАЦИЯ ЮНИФОРМ ШЕЙДЕРА ПАНОРАМНОЙ МАСКИ И РАДИАЦИОННЫХ ПОМЕХ
// ============================================================================

export interface VisorPostProcessingUniforms {
  [uniform: string]: THREE.IUniform<unknown>;
  /** Время симуляции t (с) */
  uTime: THREE.IUniform<number>;
  /** Текущая Мощность Эквивалентной Дозы (МЭД) в мЗв/ч */
  uDoseRateMsvPerHour: THREE.IUniform<number>;
  /** Нормированная интенсивность радиационного шума при превышении порога 10 мЗв/ч [0..1] */
  uRadiationNoiseFactor: THREE.IUniform<number>;
  /** Коэффициент физической нагрузки спасателя (из ЧСС 60..160 уд/мин) в диапазоне [0..1] */
  uExertionLevel: THREE.IUniform<number>;
  /** Текущая фаза дыхательного цикла (вдох/выдох) для конденсата на стекле [0..1] */
  uBreathCondensation: THREE.IUniform<number>;
  /** Коэффициент сферической дисторсии панорамного стекла (Barrel Distortion) */
  uDistortionK: THREE.IUniform<number>;
  /** Интенсивность внутренних оптических бликов поликарбонатного забрала */
  uInternalGlareIntensity: THREE.IUniform<number>;
  /** Текущий коэффициент HDR-адаптации глаза (динамическая экспозиция) */
  uEyeAdaptationExposure: THREE.IUniform<number>;
  /** Признак включенного тактического фонаря левой руки (1.0 = ВКЛ, 0.0 = ВЫКЛ) */
  uFlashlightActive: THREE.IUniform<number>;
  /** Разрешение области вывода (ширина, высота) */
  uResolution: THREE.IUniform<THREE.Vector2>;
}

export interface VisorTelemetryInput {
  /** Текущая МЭД в мЗв/ч (порог пробоя матрицы: > 10 мЗв/ч) */
  readonly doseRateMsvPerHour: number;
  /** Частота сердечных сокращений оператора (уд/мин, 60..165) */
  readonly vitalsBpm: number;
  /** Включен ли тактический фонарь левой руки */
  readonly isFlashlightOn: boolean;
  /** Находится ли оператор в темном помещении / бункере */
  readonly isLowLightZone: boolean;
}

/** Порог МЭД (мЗв/ч), выше которого начинается ионизационный пробой пикселей матрицы */
export const RADIATION_SENSOR_NOISE_THRESHOLD_MSV_H = 10.0;

// ============================================================================
// 2. GLSL ШЕЙДЕРЫ ПАНОРАМНОГО ЗАБРАЛА ПРОТИВОГАЗА И РАДИАЦИОННОГО ШУМА
// ============================================================================

export const VISOR_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vViewPos;

  void main() {
    vUv = uv;
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vViewPos = mvPos.xyz;
    gl_Position = projectionMatrix * mvPos;
  }
`;

export const VISOR_FRAGMENT_SHADER = /* glsl */ `
  precision highp float;

  varying vec2 vUv;
  varying vec3 vViewPos;

  uniform float uTime;
  uniform float uDoseRateMsvPerHour;
  uniform float uRadiationNoiseFactor;
  uniform float uExertionLevel;
  uniform float uBreathCondensation;
  uniform float uDistortionK;
  uniform float uInternalGlareIntensity;
  uniform float uEyeAdaptationExposure;
  uniform float uFlashlightActive;
  uniform vec2 uResolution;

  // Высокоскоростной псевдослучайный генератор без текстурных выборок (90 FPS VR)
  float hash12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  float valueNoise2D(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash12(i);
    float b = hash12(i + vec2(1.0, 0.0));
    float c = hash12(i + vec2(0.0, 1.0));
    float d = hash12(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Двухоктавный шум для капель конденсата и запотевания по краям маски
  float condensationFbm(vec2 uv) {
    return 0.65 * valueNoise2D(uv * 9.0) + 0.35 * valueNoise2D(uv * 21.0);
  }

  void main() {
    // Координаты относительно оптического центра забрала [-1..1]
    vec2 centered = vUv * 2.0 - 1.0;

    // -------------------------------------------------------------------------
    // а) Сферическая дисторсия забрала (Barrel Visor Distortion) и внутренние блики
    // -------------------------------------------------------------------------
    float r2 = dot(centered, centered);
    float barrelFactor = 1.0 + uDistortionK * r2 + (uDistortionK * 0.35) * r2 * r2;
    vec2 distortedCoord = centered * barrelFactor;
    float radialEdge = length(distortedCoord);

    // Оптический анаморфный блик на верхней и боковых дугах поликарбонатной линзы
    float topArcReflection = smoothstep(0.68, 0.98, radialEdge)
                           * max(0.0, distortedCoord.y * 0.75 + 0.25 * abs(distortedCoord.x));
    float flashlightRimGlare = uFlashlightActive * 0.08 * smoothstep(0.62, 0.96, radialEdge);
    vec3 internalGlareColor = vec3(0.68, 0.86, 1.0)
                            * (topArcReflection * uInternalGlareIntensity + flashlightRimGlare);

    // -------------------------------------------------------------------------
    // б) Запотевание стекла по краям маски и в нижней носовой зоне при нагрузке
    // -------------------------------------------------------------------------
    float peripheralMask = smoothstep(0.58, 1.12, radialEdge);
    // Дополнительная зона выдоха в нижней части панорамного стекла (y < -0.35)
    float nasalExhaleZone = smoothstep(-0.25, -0.92, distortedCoord.y)
                          * (1.0 - smoothstep(0.0, 0.65, abs(distortedCoord.x)));

    float fogNoise = condensationFbm(distortedCoord * 2.4 + vec2(0.0, uTime * 0.03));
    float condensationStrength = clamp(
      (peripheralMask * (0.22 + 0.55 * uExertionLevel) + nasalExhaleZone * 0.48 * uBreathCondensation)
      * (0.65 + 0.35 * fogNoise),
      0.0,
      0.72
    );
    vec3 condensationColor = vec3(0.82, 0.89, 0.95) * condensationStrength;

    // -------------------------------------------------------------------------
    // в) Радиационный шум и ионизация матрицы при МЭД > 10 мЗв/ч
    //    (белые статические точки выбитых электронов, сцинтилляции и микро-глитчи)
    // -------------------------------------------------------------------------
    vec3 radiationStaticColor = vec3(0.0);
    float radiationAlpha = 0.0;

    if (uDoseRateMsvPerHour > 10.0 && uRadiationNoiseFactor > 0.001) {
      // Строчный сдвиг (микро-глитч считывания регистра матрицы при мощном гамма-потоке)
      float scanlineSeed = hash12(vec2(floor(vUv.y * 140.0), floor(uTime * 35.0)));
      float lineGlitchMask = step(1.0 - 0.06 * uRadiationNoiseFactor, scanlineSeed);
      vec2 glitchedUv = vUv + vec2((scanlineSeed - 0.5) * 0.025 * lineGlitchMask, 0.0);

      // Квантованные ячейки матрицы для белых точек комптоновских треков
      vec2 sensorCell = floor(glitchedUv * vec2(380.0, 240.0));
      float frameTick = floor(uTime * 60.0);
      float pixelHitRng = hash12(sensorCell + vec2(frameTick * 1.73, frameTick * 3.19));

      // Вероятность пробоя пикселя растет с превышением порога 10 мЗв/ч
      float hitThreshold = 1.0 - clamp(0.018 * uRadiationNoiseFactor, 0.0005, 0.045);
      float whiteSpeckle = step(hitThreshold, pixelHitRng);

      // Вторичные короткие треки (2-3 соседних пикселя по горизонтали)
      float streakRng = hash12(sensorCell * 0.5 + vec2(frameTick * 0.91, 7.13));
      float comptonStreak = step(1.0 - 0.006 * uRadiationNoiseFactor, streakRng) * 0.75;

      // Общее высокочастотное черенковское мерцание стекловидного тела / сенсора
      float sensorFlicker = 0.04 * uRadiationNoiseFactor * (0.5 + 0.5 * sin(uTime * 95.0));

      float combinedHit = clamp(whiteSpeckle + comptonStreak, 0.0, 1.0);
      radiationStaticColor = mix(
        vec3(0.55, 0.88, 1.0) * (lineGlitchMask * 0.22 + sensorFlicker),
        vec3(1.0, 1.0, 1.0),
        combinedHit
      );
      radiationAlpha = clamp(
        combinedHit * 0.95 + lineGlitchMask * 0.18 * uRadiationNoiseFactor + sensorFlicker,
        0.0,
        0.96
      );
    }

    // -------------------------------------------------------------------------
    // г) Контурное виньетирование обтюратора противогаза и сборка слоев
    // -------------------------------------------------------------------------
    float rubberSealVignette = smoothstep(0.88, 1.24, radialEdge) * 0.42;

    // Компенсация яркости бликов с учетом текущей HDR-адаптации глаза
    float exposureMod = clamp(uEyeAdaptationExposure, 0.75, 1.45);
    vec3 visorCompositeRgb = (internalGlareColor + condensationColor) * exposureMod
                           + radiationStaticColor;
    visorCompositeRgb = mix(visorCompositeRgb, vec3(0.02, 0.03, 0.05), rubberSealVignette);

    float totalOverlayAlpha = clamp(
      condensationStrength * 0.62
      + length(internalGlareColor) * 0.45
      + radiationAlpha
      + rubberSealVignette,
      0.0,
      0.92
    );

    gl_FragColor = vec4(visorCompositeRgb, totalOverlayAlpha);
  }
`;

// ============================================================================
// 3. КЛАСС КОНТРОЛЛЕРА ПОСТ-ОБРАБОТКИ ЗАБРАЛА И АДАПТАЦИИ ГЛАЗА (VR + DESKTOP)
// ============================================================================

export class VisorPostProcessingController {
  /** Сферический купол забрала, привязываемый к камере оператора (работает в WebXR 90 FPS и на ПК) */
  public readonly visorMesh: THREE.Mesh;
  public readonly material: THREE.ShaderMaterial;
  public readonly uniforms: VisorPostProcessingUniforms;

  private breathPhaseRad = 0.0;
  private currentExposure = 1.12;

  constructor() {
    this.uniforms = {
      uTime: { value: 0.0 },
      uDoseRateMsvPerHour: { value: 0.0 },
      uRadiationNoiseFactor: { value: 0.0 },
      uExertionLevel: { value: 0.15 },
      uBreathCondensation: { value: 0.2 },
      uDistortionK: { value: 0.085 },
      uInternalGlareIntensity: { value: 0.24 },
      uEyeAdaptationExposure: { value: 1.12 },
      uFlashlightActive: { value: 0.0 },
      uResolution: {
        value: new THREE.Vector2(
          typeof window !== 'undefined' ? window.innerWidth : 1920,
          typeof window !== 'undefined' ? window.innerHeight : 1080
        )
      }
    };

    this.material = new THREE.ShaderMaterial({
      name: 'VisorPostProcessingShaderMaterial',
      uniforms: this.uniforms,
      vertexShader: VISOR_VERTEX_SHADER,
      fragmentShader: VISOR_FRAGMENT_SHADER,
      transparent: true,
      depthTest: false,
      depthWrite: false
    });

    // Слегка изогнутая сферическая поверхность панорамного стекла перед глазами в пространстве камеры
    const visorGeo = new THREE.PlaneGeometry(0.46, 0.32, 24, 16);
    const posAttr = visorGeo.attributes.position;
    for (let i = 0; i < posAttr.count; i++) {
      const x = posAttr.getX(i);
      const y = posAttr.getY(i);
      // Легкий сферический прогиб поликарбонатного забрала противогаза
      const zCurve = -0.025 * (x * x * 12.0 + y * y * 16.0);
      posAttr.setZ(i, zCurve);
    }
    visorGeo.computeVertexNormals();

    this.visorMesh = new THREE.Mesh(visorGeo, this.material);
    this.visorMesh.name = 'hazmat_visor_post_processing_lens';
    this.visorMesh.position.set(0, 0, -0.14);
    this.visorMesh.renderOrder = 999;
    this.visorMesh.frustumCulled = false;
    // Исключаем забрало из проверок Raycaster, чтобы не блокировать клики по 3D-объектам
    this.visorMesh.raycast = () => {};
  }

  /**
   * Монтирует панорамное забрало непосредственно к камере игрока
   */
  public attachToCamera(camera: THREE.Camera): void {
    if (this.visorMesh.parent !== camera) {
      camera.add(this.visorMesh);
    }
  }

  /**
   * Обновление физических параметров забрала, конденсата дыхания, радиационного шума (> 10 мЗв/ч)
   * и автоматической HDR-адаптации глаза (Exposure Adaptation) в каждом кадре.
   */
  public update(
    deltaTimeSeconds: number,
    telemetry: VisorTelemetryInput,
    renderer?: THREE.WebGLRenderer | null
  ): void {
    const dt = Math.min(0.1, Math.max(0.0, deltaTimeSeconds));
    this.uniforms.uTime.value += dt;

    // 1. Расчет физической нагрузки из ЧСС (70 уд/мин -> покой, 150 уд/мин -> пиковая нагрузка)
    const bpm = THREE.MathUtils.clamp(telemetry.vitalsBpm || 72, 60, 175);
    const exertion = THREE.MathUtils.clamp((bpm - 70) / 80, 0.05, 1.0);
    this.uniforms.uExertionLevel.value = exertion;

    // Частота дыхания растет от 0.25 Гц (15 вдохов/мин) до 0.65 Гц (39 вдохов/мин) при высокой ЧСС
    const breathFreqHz = 0.25 + 0.40 * exertion;
    this.breathPhaseRad = (this.breathPhaseRad + dt * breathFreqHz * Math.PI * 2.0) % (Math.PI * 2.0);
    // Фаза выдоха конденсирует влагу на краях стекла
    const exhalePulse = 0.5 + 0.5 * Math.sin(this.breathPhaseRad);
    const targetCondensation = (0.18 + 0.62 * exertion) * (0.55 + 0.45 * exhalePulse);
    this.uniforms.uBreathCondensation.value +=
      (targetCondensation - this.uniforms.uBreathCondensation.value) * Math.min(1.0, dt * 4.0);

    // 2. Расчет радиационного шума сенсора при МЭД > 10 мЗв/ч
    const doseRateMsv = Math.max(0.0, telemetry.doseRateMsvPerHour || 0.0);
    this.uniforms.uDoseRateMsvPerHour.value = doseRateMsv;

    if (doseRateMsv > RADIATION_SENSOR_NOISE_THRESHOLD_MSV_H) {
      // Логарифмическое нарастание пробоев матрицы от 10 мЗв/ч до 500 мЗв/ч
      const excessRatio = (doseRateMsv - RADIATION_SENSOR_NOISE_THRESHOLD_MSV_H) / 40.0;
      this.uniforms.uRadiationNoiseFactor.value = THREE.MathUtils.clamp(
        0.22 + Math.log10(1.0 + excessRatio) * 0.68,
        0.2,
        1.0
      );
    } else {
      this.uniforms.uRadiationNoiseFactor.value = 0.0;
    }

    // 3. Автоматическая адаптация глаза (HDR Exposure Adaptation) при включении фонаря в темноте
    this.uniforms.uFlashlightActive.value = telemetry.isFlashlightOn ? 1.0 : 0.0;

    const targetExposure = telemetry.isLowLightZone
      ? telemetry.isFlashlightOn
        ? 0.95 // Сужение зрачка при ярком пятне тактического фонаря 5500K
        : 1.32 // Расширение зрачка (скотопическая адаптация) в темноте
      : telemetry.isFlashlightOn
      ? 1.05
      : 1.15;

    // Асимметричная скорость адаптации: зрачок быстрее сужается на свет (4.2 с⁻¹), чем расширяется в темноте (1.8 с⁻¹)
    const adaptationSpeed = targetExposure < this.currentExposure ? 4.2 : 1.8;
    this.currentExposure +=
      (targetExposure - this.currentExposure) * Math.min(1.0, dt * adaptationSpeed);
    this.uniforms.uEyeAdaptationExposure.value = this.currentExposure;

    if (renderer) {
      renderer.toneMappingExposure = this.currentExposure;
    }
  }

  public dispose(): void {
    if (this.visorMesh.parent) {
      this.visorMesh.parent.remove(this.visorMesh);
    }
    this.visorMesh.geometry.dispose();
    this.material.dispose();
  }
}

// ============================================================================
// 4. REACT-КОМПОНЕНТ VisorPostProcessing ДЛЯ МОНТИРОВАНИЯ В СЦЕНУ / КАМЕРУ
// ============================================================================

export interface VisorPostProcessingProps extends VisorTelemetryInput {
  readonly cameraRef: React.RefObject<THREE.Camera | null>;
  readonly rendererRef?: React.RefObject<THREE.WebGLRenderer | null>;
  readonly enabled?: boolean;
}

export const VisorPostProcessing: React.FC<VisorPostProcessingProps> = ({
  cameraRef,
  rendererRef,
  doseRateMsvPerHour,
  vitalsBpm,
  isFlashlightOn,
  isLowLightZone,
  enabled = true
}) => {
  const controllerRef = useRef<VisorPostProcessingController | null>(null);
  const telemetryRef = useRef<VisorTelemetryInput>({
    doseRateMsvPerHour,
    vitalsBpm,
    isFlashlightOn,
    isLowLightZone
  });

  telemetryRef.current = {
    doseRateMsvPerHour,
    vitalsBpm,
    isFlashlightOn,
    isLowLightZone
  };

  useEffect(() => {
    const controller = new VisorPostProcessingController();
    controllerRef.current = controller;

    if (cameraRef.current) {
      controller.attachToCamera(cameraRef.current);
    }

    let lastTimeMs = performance.now();
    let hasRenderedOnce = false;
    controller.visorMesh.onBeforeRender = () => {
      const nowMs = performance.now();
      if (hasRenderedOnce && nowMs - lastTimeMs < 2) {
        return;
      }
      hasRenderedOnce = true;
      const dt = Math.min(0.1, Math.max(0.0, (nowMs - lastTimeMs) / 1000.0));
      lastTimeMs = nowMs;

      if (cameraRef.current && controller.visorMesh.parent !== cameraRef.current) {
        controller.attachToCamera(cameraRef.current);
      }
      controller.update(dt, telemetryRef.current, rendererRef?.current);
    };

    return () => {
      controller.dispose();
      controllerRef.current = null;
    };
  }, [cameraRef, rendererRef]);

  useEffect(() => {
    if (controllerRef.current) {
      controllerRef.current.visorMesh.visible = enabled;
    }
  }, [enabled]);

  return null;
};
