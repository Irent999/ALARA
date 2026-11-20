/**
 * ALARA-Planner Pro — Физический 3D-спавнер объектов радиационных угроз
 * (src/components/objects/HazardSourceSpawner.tsx)
 *
 * Генерирует детализированные PBR 3D-меши по массиву `HazardEntity[]`
 * (фрагменты ТВС, графитовые блоки, ампулы изотопов, контейнеры ТУК-13,
 * аварийные паровые коллекторы, корродированные бочки ТРО/ЖРО и SSS-лужи)
 * и интегрирует визуальные шейдеры из Шага 2:
 * - `CherenkovGlowShader` для высокоактивных источников (свечение Вавилова — Черенкова);
 * - `VolumetricPlumeSystem` для точек утечки радиоактивного пара/аэрозоля (эффект Тиндаля).
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { HazardEntity, ScenarioAtmosphereConfig } from '../../scenarios/types';
import { useScenarioManager } from '../../scenarios/ScenarioManager';
import { createCherenkovShaderMeshGroup } from '../../shaders/CherenkovGlowShader';
import { VolumetricPlumeSystem } from '../effects/VolumetricPlume';
import {
  createChemicalPuddleSSSMaterial,
  createGraphiteDebrisMaterial,
  createScorchedCorrodedMetalMaterial
} from '../../scene/pbrMaterialEngine';

// ============================================================================
// 1. ПРОЦЕДУРНЫЕ ГЕНЕРАТОРЫ 3D-ГЕОМЕТРИИ АРХЕТИПОВ УГРОЗ
// ============================================================================

function createFuelAssemblyFragmentMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [w, h, len] = entity.geometryData.dimensionsMeters;
  const scorchedMat = createScorchedCorrodedMetalMaterial(entity.geometryData.primaryColorHex);

  // Шестигранный кожух кассеты ТВС
  const hexGeo = new THREE.CylinderGeometry(w * 0.42, w * 0.42, len, 6);
  hexGeo.rotateX(Math.PI / 2);
  const casingMesh = new THREE.Mesh(hexGeo, scorchedMat);
  casingMesh.castShadow = true;
  casingMesh.receiveShadow = true;
  group.add(casingMesh);

  // Пучок циркониевых твэлов, выступающих из разрушенного торца
  const rodMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    emissive: new THREE.Color(entity.geometryData.emissiveColorHex ?? 0x0284c7),
    emissiveIntensity: 0.45,
    metalness: 0.85,
    roughness: 0.28
  });

  for (let i = 0; i < 7; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const radius = i === 0 ? 0 : w * 0.22;
    const rodGeo = new THREE.CylinderGeometry(0.016, 0.016, len * 1.28, 12);
    rodGeo.rotateX(Math.PI / 2);
    const rod = new THREE.Mesh(rodGeo, rodMat);
    rod.position.set(
      Math.cos(angle) * radius,
      Math.sin(angle) * (h * 0.22),
      0.12
    );
    rod.castShadow = true;
    group.add(rod);
  }

  return group;
}

function createGraphiteBlockMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [w, h, d] = entity.geometryData.dimensionsMeters;
  const graphiteMat = createGraphiteDebrisMaterial();

  const blockGeo = new THREE.BoxGeometry(w, h, d);
  const blockMesh = new THREE.Mesh(blockGeo, graphiteMat);
  blockMesh.castShadow = true;
  blockMesh.receiveShadow = true;
  group.add(blockMesh);

  // Внутренний технологический канал графитового блока
  const boreGeo = new THREE.CylinderGeometry(Math.min(w, d) * 0.22, Math.min(w, d) * 0.22, h * 1.04, 18);
  const boreMat = new THREE.MeshStandardMaterial({
    color: 0x09090b,
    emissive: new THREE.Color(entity.geometryData.emissiveColorHex ?? 0x0284c7),
    emissiveIntensity: 0.35,
    roughness: 0.8
  });
  const boreMesh = new THREE.Mesh(boreGeo, boreMat);
  group.add(boreMesh);

  return group;
}

function createSealedIsotopeCapsuleMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [r, len] = entity.geometryData.dimensionsMeters;
  const radius = Math.max(0.035, r * 0.5);
  const height = Math.max(0.12, len);

  const capsuleMat = new THREE.MeshStandardMaterial({
    color: entity.geometryData.primaryColorHex,
    emissive: new THREE.Color(entity.geometryData.emissiveColorHex ?? 0x38bdf8),
    emissiveIntensity: 0.65,
    metalness: 0.88,
    roughness: 0.22
  });

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 24),
    capsuleMat
  );
  body.castShadow = true;
  group.add(body);

  // Дистанционная головка под захват манипулятора
  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(radius * 0.55, radius * 0.75, height * 0.25, 16),
    capsuleMat
  );
  neck.position.y = height * 0.62;
  group.add(neck);

  return group;
}

function createTukTransportCaskMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [w, _h, len] = entity.geometryData.dimensionsMeters;
  const radius = Math.max(0.35, w * 0.48);
  const caskLen = Math.max(1.2, len);

  const steelMat = createScorchedCorrodedMetalMaterial(entity.geometryData.primaryColorHex);
  const bodyGeo = new THREE.CylinderGeometry(radius, radius, caskLen, 28);
  const bodyMesh = new THREE.Mesh(bodyGeo, steelMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  group.add(bodyMesh);

  // Оребрение теплоотвода и противоударные демпферы по торцам ТУК
  const damperMat = new THREE.MeshStandardMaterial({
    color: 0xd97706,
    metalness: 0.6,
    roughness: 0.4
  });
  for (const sign of [-1, 1]) {
    const damper = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 1.12, radius * 1.12, caskLen * 0.14, 24),
      damperMat
    );
    damper.position.y = sign * (caskLen * 0.46);
    damper.castShadow = true;
    group.add(damper);
  }

  return group;
}

function createHighPressureSteamValveMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const pipeMat = createScorchedCorrodedMetalMaterial(entity.geometryData.primaryColorHex);

  const pipe = new THREE.Mesh(
    new THREE.CylinderGeometry(0.11, 0.11, 0.75, 20),
    pipeMat
  );
  pipe.rotation.z = Math.PI / 2;
  pipe.castShadow = true;
  group.add(pipe);

  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: new THREE.Color(entity.geometryData.emissiveColorHex ?? 0x7f1d1d),
    emissiveIntensity: 0.35,
    metalness: 0.65,
    roughness: 0.35
  });
  const handwheel = new THREE.Mesh(
    new THREE.TorusGeometry(0.18, 0.024, 12, 28),
    wheelMat
  );
  handwheel.position.set(0, 0.24, 0);
  handwheel.rotation.x = Math.PI / 2;
  handwheel.castShadow = true;
  group.add(handwheel);

  return group;
}

function createCorrodedWasteDrumMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [w, h] = entity.geometryData.dimensionsMeters;
  const radius = Math.max(0.26, w * 0.48);
  const height = Math.max(0.75, h);

  const drumMat = createScorchedCorrodedMetalMaterial(entity.geometryData.primaryColorHex);
  const drum = new THREE.Mesh(
    new THREE.CylinderGeometry(radius, radius, height, 26),
    drumMat
  );
  drum.castShadow = true;
  drum.receiveShadow = true;
  group.add(drum);

  // Пояса жесткости 200-литровой бочки РАО
  const hoopMat = new THREE.MeshStandardMaterial({
    color: 0xfacc15,
    metalness: 0.7,
    roughness: 0.38
  });
  for (const offset of [-0.22, 0.22]) {
    const hoop = new THREE.Mesh(
      new THREE.TorusGeometry(radius * 1.015, 0.014, 10, 26),
      hoopMat
    );
    hoop.rotation.x = Math.PI / 2;
    hoop.position.y = height * offset;
    group.add(hoop);
  }

  return group;
}

function createRadiochemPuddleMesh(entity: HazardEntity): THREE.Group {
  const group = new THREE.Group();
  const [rx, ry, rz] = entity.geometryData.dimensionsMeters;
  const sssMat = createChemicalPuddleSSSMaterial(
    entity.geometryData.primaryColorHex,
    entity.geometryData.emissiveColorHex ?? 0x059669
  );

  const puddle = new THREE.Mesh(
    new THREE.CylinderGeometry(rx * 0.5, rz * 0.54, Math.max(0.016, ry), 36),
    sssMat
  );
  puddle.receiveShadow = true;
  group.add(puddle);

  return group;
}

// ============================================================================
// 2. ФАБРИКА СБОРКИ ПОЛНОГО 3D-УЗЛА УГРОЗЫ С ШЕЙДЕРАМИ ВАВИЛОВА — ЧЕРЕНКОВА И ПЛЮМА
// ============================================================================

export interface SpawnedHazardNode {
  readonly entity: HazardEntity;
  readonly rootGroup: THREE.Group;
  readonly plumeSystem?: VolumetricPlumeSystem;
  readonly dispose: () => void;
}

export function buildHazardEntityNode(
  entity: HazardEntity,
  atmosphere?: ScenarioAtmosphereConfig
): SpawnedHazardNode {
  const rootGroup = new THREE.Group();
  rootGroup.name = `hazard_entity_${entity.id}`;
  rootGroup.position.set(entity.position[0], entity.position[1], entity.position[2]);

  if (entity.geometryData.rotationEulerRad) {
    const [rx, ry, rz] = entity.geometryData.rotationEulerRad;
    rootGroup.rotation.set(rx, ry, rz);
  }

  // 1. Генерация базовой PBR-геометрии по архетипу
  let meshGroup: THREE.Group;
  switch (entity.geometryData.archetype) {
    case 'fuel_assembly_fragment':
      meshGroup = createFuelAssemblyFragmentMesh(entity);
      break;
    case 'graphite_block':
      meshGroup = createGraphiteBlockMesh(entity);
      break;
    case 'sealed_isotope_capsule':
      meshGroup = createSealedIsotopeCapsuleMesh(entity);
      break;
    case 'tuk_transport_cask':
      meshGroup = createTukTransportCaskMesh(entity);
      break;
    case 'high_pressure_steam_valve':
      meshGroup = createHighPressureSteamValveMesh(entity);
      break;
    case 'corroded_waste_drum':
      meshGroup = createCorrodedWasteDrumMesh(entity);
      break;
    case 'radiochem_puddle':
    default:
      meshGroup = createRadiochemPuddleMesh(entity);
      break;
  }
  rootGroup.add(meshGroup);

  // 2. Привязка кастомного шейдера Вавилова — Черенкова (CherenkovGlowShader) к высокоактивным источникам
  const shouldAttachCherenkov =
    Boolean(entity.geometryData.hasCherenkovGlow) || entity.activityGbk >= 10000.0;

  if (shouldAttachCherenkov) {
    const glowRadius = entity.geometryData.cherenkovRadiusMeters ?? 0.78;
    const activityBq = entity.activityGbk * 1e9;
    const cherenkovNode = createCherenkovShaderMeshGroup(glowRadius, {
      activityBq,
      medium: entity.materialShieldKey === 'water' ? 'water_pool' : 'ionized_air',
      wavelengthNm: 445,
      fresnelPower: 2.5
    });
    rootGroup.add(cherenkovNode);
  }

  // 3. Привязка объемного аэрозольного облака Паскуилла — Гиффорда с эффектом Тиндаля (VolumetricPlume)
  let plumeSystem: VolumetricPlumeSystem | undefined;
  if (
    (entity.type === 'plume' || entity.type === 'leak_valve') &&
    entity.geometryData.plumeConfig
  ) {
    const pCfg = entity.geometryData.plumeConfig;
    plumeSystem = new VolumetricPlumeSystem({
      particleCount: 380,
      stabilityClass: atmosphere?.stabilityClass ?? 'D',
      windSpeedMps: atmosphere?.windSpeedMps ?? 1.8,
      windDirectionRad: atmosphere?.windDirectionRad ?? 0.0,
      plumeLengthM: pCfg.plumeLengthMeters,
      releaseHeightM: pCfg.releaseHeightMeters,
      aerosolColorHex: pCfg.aerosolColorHex,
      baseOpacity: pCfg.baseOpacity
    });
    rootGroup.add(plumeSystem.rootGroup);
  }

  rootGroup.userData = {
    isHazardEntity: true,
    hazardId: entity.id,
    hazardType: entity.type,
    radionuclideKey: entity.radionuclideKey,
    activityGbk: entity.activityGbk
  };

  return {
    entity,
    rootGroup,
    plumeSystem,
    dispose: () => {
      plumeSystem?.dispose();
      rootGroup.traverse(obj => {
        const mesh = obj as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry?.dispose();
          const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
          for (const m of mats) {
            m?.dispose();
          }
        }
      });
    }
  };
}

// ============================================================================
// 3. REACT-КОМПОНЕНТ HazardSourceSpawner ДЛЯ МОНТИРОВАНИЯ В THREE.JS СЦЕНУ
// ============================================================================

export interface HazardSourceSpawnerProps {
  /** Ссылка на Three.js сцену или группу окружения */
  readonly sceneOrGroupRef: React.RefObject<THREE.Object3D | null>;
  /** Массив физических источников угроз текущего сценария */
  /** Массив источников угроз (если не передан, берется активный набор из ScenarioManager) */
  readonly hazards?: ReadonlyArray<HazardEntity>;
  /** Параметры атмосферы и ветра для ориентации гауссовых плюмов */
  readonly atmosphere?: ScenarioAtmosphereConfig;
}

export const HazardSourceSpawner: React.FC<HazardSourceSpawnerProps> = ({
  sceneOrGroupRef,
  hazards,
  atmosphere
}) => {
  const scenarioManager = useScenarioManager();
  const effectiveHazards = hazards ?? scenarioManager.activeHazards;
  const spawnedNodesRef = useRef<SpawnedHazardNode[]>([]);

  useEffect(() => {
    const parent = sceneOrGroupRef.current;
    if (!parent) return;

    const spawnerContainer = new THREE.Group();
    spawnerContainer.name = 'hazard_source_spawner_container';

    const createdNodes: SpawnedHazardNode[] = [];
    for (const hazard of effectiveHazards) {
      const node = buildHazardEntityNode(hazard, atmosphere);
      spawnerContainer.add(node.rootGroup);
      createdNodes.push(node);
    }

    parent.add(spawnerContainer);
    spawnedNodesRef.current = createdNodes;

    return () => {
      parent.remove(spawnerContainer);
      for (const node of createdNodes) {
        node.dispose();
      }
      spawnedNodesRef.current = [];
    };
  }, [sceneOrGroupRef, effectiveHazards, atmosphere]);

  return null;
};
