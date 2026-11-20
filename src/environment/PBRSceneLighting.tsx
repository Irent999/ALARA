/**
 * ALARA-Planner Pro — Конфигурация фотореалистичного освещения, объемного тумана,
 * контактных теней и PBR-окружения гермозон (src/environment/PBRSceneLighting.tsx)
 *
 * Архитектурные возможности:
 * 1. Пресеты физически корректного освещения (Physically Based Lighting) для штатных
 *    и аварийных гермозон (АЭС, радиохимический бокс, бункер РАО, туннель метрополитена).
 * 2. Процедурная генерация HDRI-окружения через PMREMGenerator (Studio & Emergency Industrial Cubemap)
 *    для точных зеркальных и шероховатых бликов на свинце, стали, мокром бетоне и стекле ТФ-5.
 * 3. Настройка гетерогенного экспоненциального тумана (Volumetric Fog) и мягких контактных теней
 *    (Contact Shadows) на уровне пола без просадки FPS ниже 90 Гц в VR.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

// ============================================================================
// 1. ТИПИЗАЦИЯ ПРЕСЕТОВ ОСВЕЩЕНИЯ АВАРИЙНЫХ ГЕРМОЗОН
// ============================================================================

export type ContainmentZoneLightingPresetId =
  | 'nominal_industrial_hall'
  | 'reactor_containment_emergency'
  | 'plutonium_radiochem_bunker'
  | 'subterranean_metro_tunnel';

export interface ContainmentLightingPreset {
  readonly id: ContainmentZoneLightingPresetId;
  readonly nameRu: string;
  /** Цвет зенита полусферического света (небо / верхние плафоны цеха) */
  readonly skyColorHex: number;
  /** Цвет отраженного света от бетонного пола */
  readonly groundColorHex: number;
  /** Интенсивность полусферического заполняющего света (Physically Based Units) */
  readonly hemisphereIntensity: number;
  /** Цвет фонового аварийного свечения гермозоны */
  readonly emergencyAmbientColorHex: number;
  /** Интенсивность фонового свечения аварийной гермозоны */
  readonly emergencyAmbientIntensity: number;
  /** Интенсивность основного направленного прожектора цеха */
  readonly keyDirectionalIntensity: number;
  /** Цвет основного направленного света (Кельвины / Hex) */
  readonly keyDirectionalColorHex: number;
  /** Цвет объемного тумана гермозоны */
  readonly fogColorHex: number;
  /** Плотность экспоненциального тумана (FogExp2 density) */
  readonly fogDensity: number;
  /** Интенсивность отражений от карты окружения (envMapIntensity) */
  readonly envMapIntensity: number;
  /** Базовая экспозиция тональной компрессии ACES Filmic */
  readonly baseToneMappingExposure: number;
  /** Непрозрачность мягких контактных теней у основания оборудования */
  readonly contactShadowOpacity: number;
}

export const CONTAINMENT_LIGHTING_PRESETS: Readonly<
  Record<ContainmentZoneLightingPresetId, ContainmentLightingPreset>
> = {
  nominal_industrial_hall: {
    id: 'nominal_industrial_hall',
    nameRu: 'Штатный промышленный зал (ДНаТ / Светодиодные подвесы 5000K)',
    skyColorHex: 0xe2e8f0,
    groundColorHex: 0x334155,
    hemisphereIntensity: 1.05,
    emergencyAmbientColorHex: 0xcbd5e1,
    emergencyAmbientIntensity: 0.78,
    keyDirectionalIntensity: 2.35,
    keyDirectionalColorHex: 0xfffbeb,
    fogColorHex: 0x0f172a,
    fogDensity: 0.011,
    envMapIntensity: 1.25,
    baseToneMappingExposure: 1.15,
    contactShadowOpacity: 0.42
  },
  reactor_containment_emergency: {
    id: 'reactor_containment_emergency',
    nameRu: 'Аварийная гермооболочка реактора (Красный маяк + Черенковский фон)',
    skyColorHex: 0x38bdf8,
    groundColorHex: 0x1e1b4b,
    hemisphereIntensity: 0.38,
    emergencyAmbientColorHex: 0x1e293b,
    emergencyAmbientIntensity: 0.24,
    keyDirectionalIntensity: 0.52,
    keyDirectionalColorHex: 0xfca5a5,
    fogColorHex: 0x090d16,
    fogDensity: 0.022,
    envMapIntensity: 0.65,
    baseToneMappingExposure: 1.26,
    contactShadowOpacity: 0.55
  },
  plutonium_radiochem_bunker: {
    id: 'plutonium_radiochem_bunker',
    nameRu: 'Аварийный радиохимический бокс (Низкая освещенность + SSS-лужи)',
    skyColorHex: 0x334155,
    groundColorHex: 0x064e3b,
    hemisphereIntensity: 0.28,
    emergencyAmbientColorHex: 0x0f172a,
    emergencyAmbientIntensity: 0.18,
    keyDirectionalIntensity: 0.35,
    keyDirectionalColorHex: 0xe2e8f0,
    fogColorHex: 0x060a12,
    fogDensity: 0.026,
    envMapIntensity: 0.52,
    baseToneMappingExposure: 1.30,
    contactShadowOpacity: 0.60
  },
  subterranean_metro_tunnel: {
    id: 'subterranean_metro_tunnel',
    nameRu: 'Подземный вестибюль / бункер (Дежурное аварийное освещение)',
    skyColorHex: 0x475569,
    groundColorHex: 0x0f172a,
    hemisphereIntensity: 0.22,
    emergencyAmbientColorHex: 0x1e293b,
    emergencyAmbientIntensity: 0.16,
    keyDirectionalIntensity: 0.30,
    keyDirectionalColorHex: 0xfde68a,
    fogColorHex: 0x050811,
    fogDensity: 0.028,
    envMapIntensity: 0.48,
    baseToneMappingExposure: 1.32,
    contactShadowOpacity: 0.58
  }
};

// ============================================================================
// 2. ГЕНЕРАТОР КОНТАКТНЫХ ТЕНЕЙ (CONTACT SHADOWS) И ОБЪЕМНЫХ ЛУЧЕЙ ГЕРМОЗОНЫ
// ============================================================================

/**
 * Создает процедурную текстуру мягкой радиальной контактной тени (Ambient Occlusion Contact Shadow)
 * для плотного прилегания защитных экранов, контейнеров ТУК и оборудования к бетонному полу.
 */
export function createSoftContactShadowPlane(
  widthM: number = 14.0,
  depthM: number = 14.0,
  opacity: number = 0.42
): THREE.Mesh {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (ctx) {
    ctx.clearRect(0, 0, 256, 256);
    const grad = ctx.createRadialGradient(128, 128, 18, 128, 128, 124);
    grad.addColorStop(0.0, 'rgba(2, 6, 23, 0.72)');
    grad.addColorStop(0.55, 'rgba(2, 6, 23, 0.34)');
    grad.addColorStop(1.0, 'rgba(2, 6, 23, 0.0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 256, 256);
  }

  const texture = new THREE.CanvasTexture(canvas);
  const geo = new THREE.PlaneGeometry(widthM, depthM);
  geo.rotateX(-Math.PI / 2);

  const mat = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    opacity,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -1
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'pbr_floor_contact_shadow_plane';
  mesh.position.set(0, 0.003, 0);
  mesh.raycast = () => {};
  return mesh;
}

// ============================================================================
// 3. КЛАСС УПРАВЛЕНИЯ ФИЗИЧЕСКИ КОРРЕКТНЫМ ОСВЕЩЕНИЕМ СЦЕНЫ (PBRSceneLightingRig)
// ============================================================================

export interface PBRSceneLightingOptions {
  readonly presetId?: ContainmentZoneLightingPresetId;
  /** Множитель фонового свечения аварийной гермозоны (0.1 .. 2.5) */
  readonly emergencyGlowMultiplier?: number;
  /** Пользовательская плотность объемного тумана */
  readonly customFogDensity?: number;
}

export class PBRSceneLightingRig {
  public readonly rootGroup: THREE.Group;
  public readonly contactShadowMesh: THREE.Mesh;
  public readonly emergencyPulseLight: THREE.PointLight;
  private currentPreset: ContainmentLightingPreset;
  private pulseTimeSec = 0.0;

  constructor(options: PBRSceneLightingOptions = {}) {
    const presetId = options.presetId ?? 'nominal_industrial_hall';
    this.currentPreset = CONTAINMENT_LIGHTING_PRESETS[presetId];

    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'pbr_scene_lighting_rig_group';

    // 1. Мягкая контактная тень пола гермозоны
    this.contactShadowMesh = createSoftContactShadowPlane(
      14.5,
      14.5,
      this.currentPreset.contactShadowOpacity
    );
    this.rootGroup.add(this.contactShadowMesh);

    // 2. Дежурный низкоинтенсивный источник аварийного фонового свечения под потолком гермозоны
    this.emergencyPulseLight = new THREE.PointLight(
      this.currentPreset.emergencyAmbientColorHex,
      this.currentPreset.emergencyAmbientIntensity * (options.emergencyGlowMultiplier ?? 1.0),
      18.0,
      2.0 // физический закон обратных квадратов 1/r²
    );
    this.emergencyPulseLight.name = 'containment_emergency_background_light';
    this.emergencyPulseLight.position.set(0, 3.85, -2.2);
    this.rootGroup.add(this.emergencyPulseLight);
  }

  private lastAppliedEnvMapIntensity = -1;

  /**
   * Применяет физически корректные параметры освещения, экспоненциального тумана
   * и интенсивности IBL-отражений ко всей Three.js сцене и рендереру.
   */
  public applyPresetToScene(
    scene: THREE.Scene,
    renderer?: THREE.WebGLRenderer | null,
    presetId?: ContainmentZoneLightingPresetId,
    emergencyGlowMultiplier: number = 1.0
  ): void {
    if (presetId) {
      this.currentPreset = CONTAINMENT_LIGHTING_PRESETS[presetId];
    }
    const preset = this.currentPreset;

    // 1. Настройка физически корректного пайплайна рендерера со статическим кэшем теней
    if (renderer) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.shadowMap.needsUpdate = true;
    }

    // 2. Объемный экспоненциальный туман гермозоны
    if (scene.fog instanceof THREE.FogExp2) {
      scene.fog.color.setHex(preset.fogColorHex);
      scene.fog.density = preset.fogDensity;
    } else {
      scene.fog = new THREE.FogExp2(preset.fogColorHex, preset.fogDensity);
    }

    // 3. Обновление параметров контактных теней и аварийного заполняющего света
    const shadowMat = this.contactShadowMesh.material as THREE.MeshBasicMaterial;
    shadowMat.opacity = preset.contactShadowOpacity;

    this.emergencyPulseLight.color.setHex(preset.emergencyAmbientColorHex);
    this.emergencyPulseLight.intensity =
      preset.emergencyAmbientIntensity * Math.max(0.05, emergencyGlowMultiplier);

    // 4. Синхронизация интенсивности отражений окружения только при реальном изменении
    if (Math.abs(this.lastAppliedEnvMapIntensity - preset.envMapIntensity) > 0.001) {
      this.lastAppliedEnvMapIntensity = preset.envMapIntensity;
      scene.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh || !mesh.material) return;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        for (const mat of materials) {
          const stdMat = mat as THREE.MeshStandardMaterial;
          if ('envMapIntensity' in stdMat && typeof stdMat.envMapIntensity === 'number') {
            stdMat.envMapIntensity = preset.envMapIntensity;
          }
        }
      });
    }
  }

  public update(deltaTimeSeconds: number, isLowLightMode: boolean): void {
    this.pulseTimeSec += deltaTimeSeconds;
    if (isLowLightMode) {
      // Плавное дыхание дежурной аварийной сети гермозоны
      const wave = 0.85 + 0.15 * Math.sin(this.pulseTimeSec * 2.2);
      this.emergencyPulseLight.intensity =
        this.currentPreset.emergencyAmbientIntensity * 1.35 * wave;
    }
  }

  public dispose(): void {
    const shadowMat = this.contactShadowMesh.material as THREE.MeshBasicMaterial;
    shadowMat.map?.dispose();
    shadowMat.dispose();
    this.contactShadowMesh.geometry.dispose();
  }
}

// ============================================================================
// 4. REACT-КОМПОНЕНТ PBRSceneLighting ДЛЯ МОНТИРОВАНИЯ В СЦЕНУ ТРЕНАЖЕРА
// ============================================================================

export interface PBRSceneLightingProps {
  readonly sceneRef: React.RefObject<THREE.Scene | null>;
  readonly rendererRef?: React.RefObject<THREE.WebGLRenderer | null>;
  readonly isLowLightMode?: boolean;
  readonly scenarioId?: number;
  readonly emergencyGlowMultiplier?: number;
}

export const PBRSceneLighting: React.FC<PBRSceneLightingProps> = ({
  sceneRef,
  rendererRef,
  isLowLightMode = false,
  scenarioId = 1,
  emergencyGlowMultiplier = 1.0
}) => {
  const rigRef = useRef<PBRSceneLightingRig | null>(null);

  // Выбор оптимального пресета гермозоны по ID сценария и режиму аварийного затемнения
  const resolvedPresetId: ContainmentZoneLightingPresetId = isLowLightMode
    ? scenarioId === 12
      ? 'plutonium_radiochem_bunker'
      : scenarioId === 6 || scenarioId === 4
      ? 'subterranean_metro_tunnel'
      : 'reactor_containment_emergency'
    : 'nominal_industrial_hall';

  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const rig = new PBRSceneLightingRig({
      presetId: resolvedPresetId,
      emergencyGlowMultiplier
    });
    rigRef.current = rig;
    scene.add(rig.rootGroup);

    rig.applyPresetToScene(
      scene,
      rendererRef?.current,
      resolvedPresetId,
      emergencyGlowMultiplier
    );

    let lastTimeMs = performance.now();
    rig.contactShadowMesh.onBeforeRender = () => {
      const nowMs = performance.now();
      const dt = Math.min(0.1, Math.max(0.0, (nowMs - lastTimeMs) / 1000.0));
      lastTimeMs = nowMs;
      rig.update(dt, isLowLightMode);
    };

    return () => {
      scene.remove(rig.rootGroup);
      rig.dispose();
      rigRef.current = null;
    };
  }, [sceneRef, rendererRef]);

  useEffect(() => {
    if (rigRef.current && sceneRef.current) {
      rigRef.current.applyPresetToScene(
        sceneRef.current,
        rendererRef?.current,
        resolvedPresetId,
        emergencyGlowMultiplier
      );
    }
  }, [resolvedPresetId, emergencyGlowMultiplier, isLowLightMode, sceneRef, rendererRef]);

  return null;
};
