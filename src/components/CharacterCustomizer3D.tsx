/**
 * ALARA-Planner Pro VR — 3D-Просмотр манекена/персонажа и кастомизация СИЗ (CharacterCustomizer3D)
 * Интерактивная сцена Three.js с вращением камеры (Orbit Controls) и динамическим обновлением
 * защитных костюмов (Л-1, КИХ-4, свинцовый фартук), СИЗОД (Лепесток, ГП-7, АСВ-2) и приборов в руках.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  RotateCcw,
  Shield,
  Eye,
  Sparkles,
  Layers,
  UserCheck
} from 'lucide-react';
import { InstrumentId, GOST_INSTRUMENTS } from '../instruments/gostInstruments';
import { RemoteToolId, REMOTE_TOOLS } from '../physics/gostPhysics';
import { COOP_ROLE_SPECIFICATIONS, type CoopSquadRole } from '../network/MultiplayerManager';
import {
  createBopReflectiveStripeTexture,
  createMchsBackPatchTexture,
  createMchsChevronTexture
} from '../scene/mchsTextures';

export type SuitTypeId =
  | 'none'
  | 'bop_suit'
  | 'l1_suit'
  | 'kih4_suit'
  | 'lead_apron'
  | 'heavy_lead_armor';

export type RespiratorTypeId =
  | 'none'
  | 'lepestok_200'
  | 'ppm88_mask'
  | 'gp7_gasmask'
  | 'gp7vm_gasmask'
  | 'asv2_scba';

export interface CharacterPPEState {
  suitId: SuitTypeId;
  respiratorId: RespiratorTypeId;
  instrumentId: InstrumentId;
}

interface CharacterCustomizer3DProps {
  ppeState: CharacterPPEState;
  onChangePPE: (newState: CharacterPPEState) => void;
  selectedRemoteToolId?: RemoteToolId;
  onChangeRemoteTool?: (toolId: RemoteToolId) => void;
  coopRole?: CoopSquadRole;
  onChangeCoopRole?: (role: CoopSquadRole) => void;
}

export const SUIT_DEFINITIONS: Record<SuitTypeId, {
  nameRu: string;
  descRu: string;
  leadEquivalentMm: number;
  alphaBlockingPercent: number;
  betaAttenuationFactor: number;
  gammaAttenuationFactor: number;
  thermalRatingC: number;
  isDielectric: boolean;
  colorHex: number;
  metalness: number;
  roughness: number;
}> = {
  none: {
    nameRu: 'Х/б Спецодежда (Повседневная)',
    descRu: 'Базовая хлопчатобумажная форма без специальных экранирующих и термостойких свойств.',
    leadEquivalentMm: 0.0,
    alphaBlockingPercent: 95.0,
    betaAttenuationFactor: 1.05,
    gammaAttenuationFactor: 1.0,
    thermalRatingC: 40,
    isDielectric: false,
    colorHex: 0xf1f5f9,
    metalness: 0.05,
    roughness: 0.9
  },
  bop_suit: {
    nameRu: 'БОП-1 МЧС / Термостойкий (ТОК-200)',
    descRu: 'Боевая одежда пожарного МЧС со световозвращающими полосами, термозащитой до 350°C и диэлектрическими крагами для тушения кабельных отсеков АЭС.',
    leadEquivalentMm: 0.05,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 4.6,
    gammaAttenuationFactor: 1.08,
    thermalRatingC: 350,
    isDielectric: true,
    colorHex: 0x1e293b,
    metalness: 0.14,
    roughness: 0.62
  },
  l1_suit: {
    nameRu: 'Костюм химзащиты Л-1 (МЧС)',
    descRu: 'Прорезиненный изолирующий комбинезон с капюшоном, чулками и перчатками. Защита от радиоактивной пыли, аэрозолей и брызг.',
    leadEquivalentMm: 0.08,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 3.2,
    gammaAttenuationFactor: 1.1,
    thermalRatingC: 65,
    isDielectric: false,
    colorHex: 0x4d7c0f,
    metalness: 0.15,
    roughness: 0.7
  },
  kih4_suit: {
    nameRu: 'Изолирующий комплекс КИХ-4',
    descRu: 'Герметичный химико-радиационный скафандр высшего класса защиты с панорамным иллюминатором для экстремальных аварийных зон АЭС.',
    leadEquivalentMm: 0.25,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 8.0,
    gammaAttenuationFactor: 1.35,
    thermalRatingC: 90,
    isDielectric: true,
    colorHex: 0xf59e0b,
    metalness: 0.3,
    roughness: 0.4
  },
  lead_apron: {
    nameRu: 'Свинцовый фартук (0.50 мм Pb)',
    descRu: 'Рентгенозащитный свинцово-виниловый фартук для защиты щитовидной железы и органов грудной клетки от гамма-квантов.',
    leadEquivalentMm: 0.50,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 5.5,
    gammaAttenuationFactor: 1.85,
    thermalRatingC: 60,
    isDielectric: false,
    colorHex: 0x0284c7,
    metalness: 0.2,
    roughness: 0.5
  },
  heavy_lead_armor: {
    nameRu: 'Тяжелый бронекомплект ликвидатора (2.5 мм Pb)',
    descRu: 'Многослойный свинцово-стальной жилет и наплечники для кратковременных операций в полях высокой мощности дозы.',
    leadEquivalentMm: 2.5,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 45.0,
    gammaAttenuationFactor: 3.8,
    thermalRatingC: 120,
    isDielectric: false,
    colorHex: 0x334155,
    metalness: 0.8,
    roughness: 0.3
  }
};

export const RESPIRATOR_DEFINITIONS: Record<RespiratorTypeId, {
  nameRu: string;
  descRu: string;
  filtrationEfficiencyPercent: number;
  inhalationProtectionFactor: number;
  colorHex: number;
}> = {
  none: {
    nameRu: 'Без защиты органов дыхания',
    descRu: 'Свободное дыхание атмосферным воздухом. Риск ингаляции радиоактивных аэрозолей и продуктов горения.',
    filtrationEfficiencyPercent: 0.0,
    inhalationProtectionFactor: 1.0,
    colorHex: 0x000000
  },
  lepestok_200: {
    nameRu: 'Респиратор ШБ-1 «Лепесток-200»',
    descRu: 'Фильтрующий респиратор на материале ФПП-15. Эффективность задержания радиоактивных аэрозолей 99.9%.',
    filtrationEfficiencyPercent: 99.9,
    inhalationProtectionFactor: 200.0,
    colorHex: 0xffffff
  },
  ppm88_mask: {
    nameRu: 'Панорамная маска ППМ-88 (МЧС)',
    descRu: 'Полнолицевая панорамная маска с поликарбонатным стеклом, переговорным устройством и комбинированным фильтром от дыма и аэрозолей.',
    filtrationEfficiencyPercent: 99.99,
    inhalationProtectionFactor: 2500.0,
    colorHex: 0x111827
  },
  gp7_gasmask: {
    nameRu: 'Противогаз ГП-7 с фильтром ФПК',
    descRu: 'Фильтрующий гражданский противогаз с активированным углем и аэрозольным фильтром.',
    filtrationEfficiencyPercent: 99.98,
    inhalationProtectionFactor: 1000.0,
    colorHex: 0x1c1917
  },
  gp7vm_gasmask: {
    nameRu: 'Противогаз ГП-7ВМ (с питьевой системой)',
    descRu: 'Модернизированный противогаз МЧС с трапециевидными очковыми стеклами, ФПК от ¹³¹I и трубкой для приема воды в зоне заражения.',
    filtrationEfficiencyPercent: 99.99,
    inhalationProtectionFactor: 2000.0,
    colorHex: 0x1e293b
  },
  asv2_scba: {
    nameRu: 'Дыхательный аппарат АСВ-2 (Изолирующий)',
    descRu: 'Автономный аппарат со сжатым воздухом (300 бар) и панорамной маской избыточного давления. 100% изоляция при задымлении и ЧС.',
    filtrationEfficiencyPercent: 100.0,
    inhalationProtectionFactor: 10000.0,
    colorHex: 0x0284c7
  }
};

function disposeMannequinGroup(group: THREE.Group): void {
  const disposedMats = new Set<THREE.Material>();
  group.traverse(obj => {
    if ((obj as THREE.Mesh).isMesh) {
      const mesh = obj as THREE.Mesh;
      mesh.geometry?.dispose();
      const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
      mats.forEach(mat => {
        if (!mat || disposedMats.has(mat)) return;
        disposedMats.add(mat);
        const std = mat as THREE.MeshStandardMaterial;
        std.map?.dispose();
        mat.dispose();
      });
    }
  });
  while (group.children.length > 0) {
    group.remove(group.children[0]);
  }
}

export const CharacterCustomizer3D: React.FC<CharacterCustomizer3DProps> = ({
  ppeState,
  onChangePPE,
  selectedRemoteToolId = 'hand',
  onChangeRemoteTool,
  coopRole = 'RECON_DOSIMETRIST',
  onChangeCoopRole
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const mannequinGroupRef = useRef<THREE.Group | null>(null);
  const ringMatRef = useRef<THREE.MeshBasicMaterial | null>(null);
  const targetZoomRef = useRef<number>(2.85);

  useEffect(() => {
    targetZoomRef.current =
      selectedRemoteToolId === 'telescopic_rod_3m'
        ? 3.75
        : selectedRemoteToolId === 'manipulator_15m'
        ? 3.25
        : 2.85;
  }, [selectedRemoteToolId]);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 460;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 25);
    camera.position.set(0, 1.35, 2.85);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Студийный свет для демонстрации материалов СИЗ
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.25);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 2.4);
    dirLight.position.set(2.0, 3.5, 2.5);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width = 1024;
    dirLight.shadow.mapSize.height = 1024;
    scene.add(dirLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.8);
    rimLight.position.set(-2.0, 2.0, -2.0);
    scene.add(rimLight);

    // Постамент
    const pedestalGeo = new THREE.CylinderGeometry(0.75, 0.8, 0.08, 36);
    const pedestalMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.4,
      metalness: 0.8
    });
    const pedestal = new THREE.Mesh(pedestalGeo, pedestalMat);
    pedestal.position.y = 0.04;
    pedestal.receiveShadow = true;
    scene.add(pedestal);

    // Световое кольцо роли на постаменте
    const ringGeo = new THREE.RingGeometry(0.70, 0.74, 36);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
    ringMatRef.current = ringMat;
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.082;
    scene.add(ring);

    // Корневая группа персонажа
    const mannequinGroup = new THREE.Group();
    scene.add(mannequinGroup);
    mannequinGroupRef.current = mannequinGroup;

    // Вращение мышью (Orbit)
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotY = 0.35;
    let rotX = 0.06;
    let zoom = targetZoomRef.current;

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onMouseUp = () => {
      isDragging = false;
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      rotY += (e.clientX - prevX) * 0.008;
      rotX = Math.max(-0.4, Math.min(0.6, rotX + (e.clientY - prevY) * 0.008));
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      targetZoomRef.current = Math.max(1.6, Math.min(4.8, targetZoomRef.current + e.deltaY * 0.002));
    };

    const dom = renderer.domElement;
    dom.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mouseup', onMouseUp);
    window.addEventListener('mousemove', onMouseMove);
    dom.addEventListener('wheel', onWheel, { passive: false });

    let animId = 0;
    const animate = () => {
      animId = requestAnimationFrame(animate);

      if (mannequinGroupRef.current) {
        mannequinGroupRef.current.rotation.y += (rotY - mannequinGroupRef.current.rotation.y) * 0.12;
      }
      zoom += (targetZoomRef.current - zoom) * 0.1;

      camera.position.x = Math.sin(rotX) * 0.35;
      camera.position.y = 1.32 + Math.sin(rotX) * 0.6;
      camera.position.z = zoom;
      camera.lookAt(0, 1.15, 0.15);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth || 460;
      const h = mountRef.current.clientHeight || 420;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      dom.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mouseup', onMouseUp);
      window.removeEventListener('mousemove', onMouseMove);
      dom.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      if (mannequinGroupRef.current) {
        disposeMannequinGroup(mannequinGroupRef.current);
      }
      pedestalGeo.dispose();
      pedestalMat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      renderer.dispose();
    };
  }, []);

  // Перестроение геометрии манекена и экипировки при смене СИЗ, инструмента и роли звена
  useEffect(() => {
    const group = mannequinGroupRef.current;
    if (!group) return;

    disposeMannequinGroup(group);

    const suit = SUIT_DEFINITIONS[ppeState.suitId];
    const roleSpec = COOP_ROLE_SPECIFICATIONS[coopRole] || COOP_ROLE_SPECIFICATIONS.RECON_DOSIMETRIST;
    if (ringMatRef.current) {
      ringMatRef.current.color.setHex(roleSpec.accentHexNumber);
    }

    const suitMat = new THREE.MeshStandardMaterial({
      color: suit.colorHex,
      roughness: suit.roughness,
      metalness: suit.metalness
    });

    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.6,
      metalness: 0.05
    });

    const roleMat = new THREE.MeshStandardMaterial({
      color: roleSpec.accentHexNumber,
      emissive: new THREE.Color(roleSpec.accentHexNumber),
      emissiveIntensity: 0.38,
      roughness: 0.35,
      metalness: 0.25
    });

    // 1. Ноги и сапоги / бахилы Л-1
    const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.85, 16);
    const leftLeg = new THREE.Mesh(legGeo, suitMat);
    leftLeg.position.set(-0.16, 0.52, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, suitMat);
    rightLeg.position.set(0.16, 0.52, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    const bootColor = ppeState.suitId === 'l1_suit' ? 0x365314 : 0x0f172a;
    const bootMat = new THREE.MeshStandardMaterial({ color: bootColor, roughness: 0.45 });
    const bootGeo = new THREE.BoxGeometry(0.14, 0.14, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(-0.16, 0.10, 0.04);
    group.add(leftBoot);

    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0.16, 0.10, 0.04);
    group.add(rightBoot);

    // 2. Торс / Тело + нагрудная идентификационная полоса роли звена РХБЗ
    const torsoGeo = new THREE.BoxGeometry(0.48, 0.68, 0.28);
    const torso = new THREE.Mesh(torsoGeo, suitMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;
    group.add(torso);

    const chestRoleStripe = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.025), roleMat);
    chestRoleStripe.position.set(-0.08, 1.46, 0.142);
    group.add(chestRoleStripe);

    // 3. Руки и перчатки
    const isExtendedVisual = selectedRemoteToolId === 'extended_arm';
    const armGeo = new THREE.CylinderGeometry(0.07, 0.065, 0.62, 16);
    const leftArm = new THREE.Mesh(armGeo, suitMat);
    leftArm.position.set(-0.33, 1.25, 0);
    leftArm.rotation.z = 0.15;
    leftArm.castShadow = true;
    group.add(leftArm);

    // Нарукавная повязка роли звена (левый рукав)
    const armband = new THREE.Mesh(new THREE.CylinderGeometry(0.076, 0.076, 0.08, 16), roleMat);
    armband.position.set(-0.33, 1.36, 0);
    armband.rotation.z = 0.15;
    group.add(armband);

    const rightArm = new THREE.Mesh(armGeo, suitMat);
    if (isExtendedVisual) {
      rightArm.position.set(0.32, 1.34, 0.24);
      rightArm.rotation.x = -1.18;
      rightArm.rotation.z = -0.06;
    } else {
      rightArm.position.set(0.33, 1.25, 0.12);
      rightArm.rotation.x = -0.55;
      rightArm.rotation.z = -0.15;
    }
    rightArm.castShadow = true;
    group.add(rightArm);

    // Перчатки (у Л-1 и БОП-1 — выраженные защитные краги)
    const gloveMat = new THREE.MeshStandardMaterial({
      color: ppeState.suitId === 'none' ? 0xfbbf24 : ppeState.suitId === 'bop_suit' ? 0xb45309 : 0x1e293b,
      roughness: 0.55
    });
    const glovePos = isExtendedVisual ? new THREE.Vector3(0.32, 1.22, 0.50) : new THREE.Vector3(0.33, 1.0, 0.26);
    const rightGlove = new THREE.Mesh(new THREE.SphereGeometry(0.062, 14, 14), gloveMat);
    rightGlove.position.copy(glovePos);
    group.add(rightGlove);

    // 4. Голова и шея
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 16), skinMat);
    neck.position.set(0, 1.62, 0);
    group.add(neck);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 24, 24), skinMat);
    head.position.set(0, 1.76, 0);
    head.castShadow = true;
    group.add(head);

    // Шевроны МЧС Узбекистана на рукавах и нашивка на спине
    if (ppeState.suitId !== 'none') {
      const chevronMat = new THREE.MeshBasicMaterial({
        map: createMchsChevronTexture(),
        transparent: true,
        side: THREE.DoubleSide
      });
      const chevronGeo = new THREE.PlaneGeometry(0.085, 0.105);
      const leftChevron = new THREE.Mesh(chevronGeo, chevronMat);
      leftChevron.position.set(-0.375, 1.44, 0.01);
      leftChevron.rotation.y = -Math.PI / 2;
      group.add(leftChevron);

      const rightChevron = new THREE.Mesh(chevronGeo, chevronMat);
      rightChevron.position.set(0.375, 1.44, 0.06);
      rightChevron.rotation.y = Math.PI / 2;
      group.add(rightChevron);

      const backPatch = new THREE.Mesh(
        new THREE.PlaneGeometry(0.34, 0.105),
        new THREE.MeshBasicMaterial({ map: createMchsBackPatchTexture(), side: THREE.DoubleSide })
      );
      backPatch.position.set(0, 1.38, -0.146);
      backPatch.rotation.y = Math.PI;
      group.add(backPatch);
    }

    // Особенности костюмов (БОП-1, Л-1, Фартук, Бронекомплект, КИХ-4)
    if (ppeState.suitId === 'bop_suit') {
      const stripeMat = new THREE.MeshStandardMaterial({
        map: createBopReflectiveStripeTexture(),
        roughness: 0.25,
        metalness: 0.45,
        emissive: new THREE.Color(0x65a30d),
        emissiveIntensity: 0.28
      });
      const chestStripe = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.055, 0.292), stripeMat);
      chestStripe.position.set(0, 1.24, 0);
      group.add(chestStripe);

      const waistStripe = new THREE.Mesh(new THREE.BoxGeometry(0.49, 0.055, 0.292), stripeMat);
      waistStripe.position.set(0, 0.96, 0);
      group.add(waistStripe);

      const legStripeL = new THREE.Mesh(new THREE.CylinderGeometry(0.092, 0.088, 0.06, 16), stripeMat);
      legStripeL.position.set(-0.16, 0.34, 0);
      group.add(legStripeL);

      const legStripeR = legStripeL.clone();
      legStripeR.position.x = 0.16;
      group.add(legStripeR);

      const bopHelmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.165, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62),
        new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.25, metalness: 0.2 })
      );
      bopHelmet.position.set(0, 1.79, 0);
      group.add(bopHelmet);

      const brim = new THREE.Mesh(
        new THREE.CylinderGeometry(0.175, 0.185, 0.025, 24),
        new THREE.MeshStandardMaterial({ color: 0xf97316, roughness: 0.3 })
      );
      brim.position.set(0, 1.79, -0.02);
      group.add(brim);

      const goldVisor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.158, 0.158, 0.10, 20, 1, true, -Math.PI * 0.38, Math.PI * 0.76),
        new THREE.MeshStandardMaterial({
          color: 0xfacc15,
          metalness: 0.92,
          roughness: 0.08,
          transparent: true,
          opacity: 0.78,
          side: THREE.DoubleSide
        })
      );
      goldVisor.position.set(0, 1.75, 0.02);
      group.add(goldVisor);
    } else if (ppeState.suitId === 'l1_suit') {
      // Капюшон прорезиненного костюма Л-1 с шейной пелериной и фиксирующими ремешками
      const hoodMat = new THREE.MeshStandardMaterial({ color: 0x4d7c0f, roughness: 0.68, metalness: 0.15 });
      const hood = new THREE.Mesh(
        new THREE.SphereGeometry(0.156, 20, 18, 0, Math.PI * 2, 0, Math.PI * 0.68),
        hoodMat
      );
      hood.position.set(0, 1.78, -0.01);
      group.add(hood);

      const hoodCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.165, 0.14, 18), hoodMat);
      hoodCollar.position.set(0, 1.62, -0.01);
      group.add(hoodCollar);

      const beltMat = new THREE.MeshStandardMaterial({ color: 0x365314, roughness: 0.75 });
      const belt = new THREE.Mesh(new THREE.BoxGeometry(0.50, 0.05, 0.30), beltMat);
      belt.position.set(0, 0.98, 0);
      group.add(belt);
    } else if (ppeState.suitId === 'lead_apron') {
      const apronMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.4 });
      const apron = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.78, 0.06), apronMat);
      apron.position.set(0, 1.13, 0.13);
      group.add(apron);

      const thyroidCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.10, 0.12, 0.07, 16), apronMat);
      thyroidCollar.position.set(0, 1.59, 0.02);
      group.add(thyroidCollar);
    } else if (ppeState.suitId === 'heavy_lead_armor') {
      // Тяжёлый бронекомплект 2.5 мм Pb: бронепластина спереди/сзади, массивные наплечники, воротник и пояс
      const armorMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.32, metalness: 0.85 });
      const trimMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, roughness: 0.25, metalness: 0.9 });

      const chestArmor = new THREE.Mesh(new THREE.BoxGeometry(0.51, 0.62, 0.35), armorMat);
      chestArmor.position.set(0, 1.27, 0.01);
      group.add(chestArmor);

      const plateTrim = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.04, 0.365), trimMat);
      plateTrim.position.set(0, 1.44, 0.01);
      group.add(plateTrim);

      const pauldronGeo = new THREE.BoxGeometry(0.17, 0.16, 0.24);
      const leftPauldron = new THREE.Mesh(pauldronGeo, armorMat);
      leftPauldron.position.set(-0.32, 1.52, 0);
      leftPauldron.rotation.z = 0.22;
      group.add(leftPauldron);

      const rightPauldron = new THREE.Mesh(pauldronGeo, armorMat);
      rightPauldron.position.set(0.32, 1.52, 0);
      rightPauldron.rotation.z = -0.22;
      group.add(rightPauldron);

      const gorget = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.14, 0.10, 18), armorMat);
      gorget.position.set(0, 1.61, 0);
      group.add(gorget);

      const heavyHelmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.165, 22, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
        armorMat
      );
      heavyHelmet.position.set(0, 1.78, 0);
      group.add(heavyHelmet);
    } else if (ppeState.suitId === 'kih4_suit') {
      const helmet = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 })
      );
      helmet.position.set(0, 1.76, 0);
      group.add(helmet);

      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.26, 0.16, 0.12),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.1,
          metalness: 0.9,
          transparent: true,
          opacity: 0.75
        })
      );
      visor.position.set(0, 1.78, 0.14);
      group.add(visor);
    }

    // 5. Защита дыхания (СИЗОД)
    if (ppeState.respiratorId === 'lepestok_200') {
      const mask = new THREE.Mesh(
        new THREE.ConeGeometry(0.10, 0.09, 16),
        new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 })
      );
      mask.rotation.x = Math.PI / 2;
      mask.position.set(0, 1.73, 0.14);
      group.add(mask);
    } else if (ppeState.respiratorId === 'ppm88_mask') {
      const sealMesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.148, 20, 20),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.7 })
      );
      sealMesh.position.set(0, 1.76, 0.02);
      group.add(sealMesh);

      const panoVisor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.14, 0.13, 0.14, 24, 1, true, -Math.PI * 0.4, Math.PI * 0.8),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.08,
          metalness: 0.85,
          transparent: true,
          opacity: 0.68,
          side: THREE.DoubleSide
        })
      );
      panoVisor.position.set(0, 1.77, 0.045);
      group.add(panoVisor);

      const frontFilter = new THREE.Mesh(
        new THREE.CylinderGeometry(0.048, 0.048, 0.085, 18),
        new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.65, roughness: 0.3 })
      );
      frontFilter.rotation.x = Math.PI / 2;
      frontFilter.position.set(0, 1.66, 0.16);
      group.add(frontFilter);
    } else if (ppeState.respiratorId === 'gp7_gasmask' || ppeState.respiratorId === 'gp7vm_gasmask') {
      const mask = new THREE.Mesh(
        new THREE.SphereGeometry(0.15, 16, 16),
        new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.8 })
      );
      mask.position.set(0, 1.76, 0.03);
      group.add(mask);

      const filterCanister = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.11, 16),
        new THREE.MeshStandardMaterial({ color: 0x3f6212, metalness: 0.6 })
      );
      filterCanister.position.set(-0.09, 1.66, 0.13);
      filterCanister.rotation.z = 0.35;
      group.add(filterCanister);

      if (ppeState.respiratorId === 'gp7vm_gasmask') {
        const drinkTube = new THREE.Mesh(
          new THREE.CylinderGeometry(0.009, 0.009, 0.18, 10),
          new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.3 })
        );
        drinkTube.position.set(0.08, 1.64, 0.14);
        drinkTube.rotation.z = -0.3;
        group.add(drinkTube);
      }
    } else if (ppeState.respiratorId === 'asv2_scba') {
      // Двухбаллонный изолирующий аппарат АСВ-2 с панорамной маской, редуктором, плечевыми лямками и манометром
      const tankMat = new THREE.MeshStandardMaterial({ color: 0xfacc15, metalness: 0.65, roughness: 0.25 });
      const yokeMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.3 });
      const tankGeo = new THREE.CylinderGeometry(0.072, 0.072, 0.54, 18);

      const leftTank = new THREE.Mesh(tankGeo, tankMat);
      leftTank.position.set(-0.085, 1.24, -0.22);
      group.add(leftTank);

      const rightTank = new THREE.Mesh(tankGeo, tankMat);
      rightTank.position.set(0.085, 1.24, -0.22);
      group.add(rightTank);

      const manifold = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.06, 0.07), yokeMat);
      manifold.position.set(0, 1.52, -0.22);
      group.add(manifold);

      const scbaMask = new THREE.Mesh(
        new THREE.SphereGeometry(0.148, 20, 20),
        new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.65 })
      );
      scbaMask.position.set(0, 1.76, 0.02);
      group.add(scbaMask);

      const scbaVisor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.142, 0.132, 0.14, 24, 1, true, -Math.PI * 0.42, Math.PI * 0.84),
        new THREE.MeshStandardMaterial({
          color: 0x38bdf8,
          roughness: 0.08,
          metalness: 0.9,
          transparent: true,
          opacity: 0.72,
          side: THREE.DoubleSide
        })
      );
      scbaVisor.position.set(0, 1.77, 0.045);
      group.add(scbaVisor);

      const gauge = new THREE.Mesh(
        new THREE.CylinderGeometry(0.032, 0.032, 0.025, 14),
        new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: new THREE.Color(0x059669), emissiveIntensity: 0.4 })
      );
      gauge.rotation.x = Math.PI / 2;
      gauge.position.set(0.12, 1.38, 0.15);
      group.add(gauge);
    }

    // 6. Прибор + Дистанционный инструмент в правой руке
    const instProfile = GOST_INSTRUMENTS[ppeState.instrumentId];
    const handOrigin = isExtendedVisual
      ? new THREE.Vector3(0.32, 1.20, 0.50)
      : new THREE.Vector3(0.33, 1.00, 0.28);

    const devBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.11, 0.19, 0.065),
      new THREE.MeshStandardMaterial({ color: instProfile.model3dDetails.color, metalness: 0.55, roughness: 0.35 })
    );
    devBox.position.copy(handOrigin);
    devBox.rotation.x = -0.35;
    group.add(devBox);

    if (selectedRemoteToolId === 'telescopic_rod_3m') {
      // Многосекционная карбоновая штанга 2.8 м + вынесенный блок детектирования на наконечнике
      const carbonMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.45 });
      const collarMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.25, metalness: 0.75 });
      const s1 = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.021, 0.65, 14), carbonMat);
      s1.rotation.x = Math.PI / 2.25;
      s1.position.set(handOrigin.x, handOrigin.y + 0.08, handOrigin.z + 0.34);
      group.add(s1);

      const s2 = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.016, 0.65, 14), carbonMat);
      s2.rotation.x = Math.PI / 2.25;
      s2.position.set(handOrigin.x, handOrigin.y + 0.19, handOrigin.z + 0.88);
      group.add(s2);

      const s3 = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.012, 0.60, 14), carbonMat);
      s3.rotation.x = Math.PI / 2.25;
      s3.position.set(handOrigin.x, handOrigin.y + 0.30, handOrigin.z + 1.40);
      group.add(s3);

      const tipHead = new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.024, 0.14, 16), collarMat);
      tipHead.rotation.x = Math.PI / 2.25;
      tipHead.position.set(handOrigin.x, handOrigin.y + 0.37, handOrigin.z + 1.72);
      group.add(tipHead);
    } else if (selectedRemoteToolId === 'manipulator_15m') {
      // Захват-манипулятор ЦМ-1.5 со штангой и механическими челюстями на конце
      const rodMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.82, roughness: 0.25 });
      const jawMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.7, roughness: 0.3 });

      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.018, 1.15, 14), rodMat);
      shaft.rotation.x = Math.PI / 2.2;
      shaft.position.set(handOrigin.x, handOrigin.y + 0.12, handOrigin.z + 0.58);
      group.add(shaft);

      const jawL = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.14), jawMat);
      jawL.position.set(handOrigin.x - 0.045, handOrigin.y + 0.22, handOrigin.z + 1.16);
      jawL.rotation.y = 0.22;
      group.add(jawL);

      const jawR = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.03, 0.14), jawMat);
      jawR.position.set(handOrigin.x + 0.045, handOrigin.y + 0.22, handOrigin.z + 1.16);
      jawR.rotation.y = -0.22;
      group.add(jawR);
    } else if (selectedRemoteToolId === 'extended_arm') {
      // Кольцевой маркер удлинения вытянутой руки (+0.45 м)
      const reachRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.075, 0.008, 10, 24),
        new THREE.MeshBasicMaterial({ color: 0x14b8a6 })
      );
      reachRing.position.set(handOrigin.x, handOrigin.y + 0.02, handOrigin.z + 0.14);
      group.add(reachRing);
    } else if (ppeState.instrumentId === 'dp5') {
      const probeRod = new THREE.Mesh(
        new THREE.CylinderGeometry(0.016, 0.016, 0.28, 16),
        new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.85, roughness: 0.2 })
      );
      probeRod.rotation.x = Math.PI / 2.4;
      probeRod.position.set(handOrigin.x, handOrigin.y + 0.02, handOrigin.z + 0.16);
      group.add(probeRod);
    }
  }, [ppeState, selectedRemoteToolId, coopRole]);

  const [showDetails, setShowDetails] = useState(false);

  const currentSuit = SUIT_DEFINITIONS[ppeState.suitId];
  const currentResp = RESPIRATOR_DEFINITIONS[ppeState.respiratorId];
  const currentTool = REMOTE_TOOLS[selectedRemoteToolId] || REMOTE_TOOLS.hand;
  const currentRoleSpec = COOP_ROLE_SPECIFICATIONS[coopRole] || COOP_ROLE_SPECIFICATIONS.RECON_DOSIMETRIST;
  const effectiveReachM = 3.2 + currentTool.addedDistanceM + currentRoleSpec.modifiers.interactionReachBonusM;

  return (
    <div className="flex flex-col lg:flex-row gap-4 items-stretch w-full">
      {/* 3D Сцена манекена */}
      <div className="relative flex-1 min-h-[360px] rounded-xl overflow-hidden border border-slate-400/15 bg-[#0B1117] flex items-center justify-center">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        <div className="absolute top-3 left-3 alara-glass rounded-[10px] px-2.5 py-1 text-[11px] text-[#94A3B8] pointer-events-none flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5 text-[#0EA5E9]" />
          <span>360° CAD</span>
        </div>
        <div className="absolute bottom-3 left-3 right-3 alara-glass rounded-[10px] px-3 py-1.5 text-[11px] font-mono alara-tabular pointer-events-none flex flex-wrap items-center justify-between gap-2 text-[#F1F5F9]">
          <span style={{ color: currentRoleSpec.primaryColorHex }} className="font-semibold">
            {currentRoleSpec.callsignRu}
          </span>
          <span className="text-[#94A3B8]">
            <strong className="text-[#0EA5E9]">{currentTool.shortNameRu}</strong> ·{' '}
            <strong className="text-[#10B981]">{effectiveReachM.toFixed(1)} м</strong>
          </span>
        </div>
      </div>

      {/* Панель переключения СИЗ, инструмента, роли и прибора */}
      <div className="w-full lg:w-96 flex flex-col gap-2.5 text-xs">
        <div className="p-3 rounded-xl alara-surface space-y-1.5">
          <label className="font-semibold text-[#F1F5F9] flex items-center gap-1.5">
            <Shield className="w-3.5 h-3.5 text-[#0EA5E9]" />
            <span>Костюм</span>
          </label>
          <select
            value={ppeState.suitId}
            onChange={e => onChangePPE({ ...ppeState, suitId: e.target.value as SuitTypeId })}
            className="w-full bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 text-[#14B8A6] font-mono font-medium focus:outline-none focus:border-[#0EA5E9]"
          >
            {Object.entries(SUIT_DEFINITIONS).map(([id, s]) => (
              <option key={id} value={id}>
                {s.nameRu} ({s.leadEquivalentMm > 0 ? `${s.leadEquivalentMm} мм Pb` : 'х/б'})
              </option>
            ))}
          </select>
        </div>

        <div className="p-3 rounded-xl alara-surface space-y-1.5">
          <label className="font-semibold text-[#F1F5F9] flex items-center gap-1.5">
            <Eye className="w-3.5 h-3.5 text-[#10B981]" />
            <span>СИЗОД / Маска</span>
          </label>
          <select
            value={ppeState.respiratorId}
            onChange={e => onChangePPE({ ...ppeState, respiratorId: e.target.value as RespiratorTypeId })}
            className="w-full bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 text-[#10B981] font-mono font-medium focus:outline-none focus:border-[#10B981]"
          >
            {Object.entries(RESPIRATOR_DEFINITIONS).map(([id, r]) => (
              <option key={id} value={id}>
                {r.nameRu} (КЗ {r.inhalationProtectionFactor})
              </option>
            ))}
          </select>
        </div>

        <div className="p-3 rounded-xl alara-surface space-y-1.5">
          <label className="font-semibold text-[#F1F5F9] flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-[#F59E0B]" />
            <span>Прибор</span>
          </label>
          <select
            value={ppeState.instrumentId}
            onChange={e => onChangePPE({ ...ppeState, instrumentId: e.target.value as InstrumentId })}
            className="w-full bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 text-[#F59E0B] font-mono font-medium focus:outline-none focus:border-[#F59E0B]"
          >
            {Object.values(GOST_INSTRUMENTS).map(inst => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.detectedRadiation.join(', ')})
              </option>
            ))}
          </select>
        </div>

        {onChangeRemoteTool && (
          <div className="p-3 rounded-xl alara-surface space-y-1.5">
            <label className="font-semibold text-[#F1F5F9] flex items-center gap-1.5">
              <Layers className="w-3.5 h-3.5 text-[#0EA5E9]" />
              <span>Инструмент</span>
            </label>
            <select
              value={selectedRemoteToolId}
              onChange={e => onChangeRemoteTool(e.target.value as RemoteToolId)}
              className="w-full bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 text-[#0EA5E9] font-mono font-medium focus:outline-none focus:border-[#0EA5E9]"
            >
              {Object.values(REMOTE_TOOLS).map(tool => (
                <option key={tool.id} value={tool.id}>
                  {tool.shortNameRu}
                </option>
              ))}
            </select>
          </div>
        )}

        {onChangeCoopRole && (
          <div className="p-3 rounded-xl alara-surface space-y-1.5">
            <label className="font-semibold text-[#F1F5F9] flex items-center gap-1.5">
              <UserCheck className="w-3.5 h-3.5 text-[#14B8A6]" />
              <span>Роль звена</span>
            </label>
            <select
              value={coopRole}
              onChange={e => onChangeCoopRole(e.target.value as CoopSquadRole)}
              className="w-full bg-[#0B1117] border border-slate-400/20 rounded-[10px] px-2.5 py-1.5 text-[#F1F5F9] font-mono font-medium focus:outline-none focus:border-[#14B8A6]"
            >
              {Object.values(COOP_ROLE_SPECIFICATIONS).map(spec => (
                <option key={spec.role} value={spec.role}>
                  {spec.callsignRu} · {spec.titleRu}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="p-3 rounded-xl alara-surface text-[11px] font-mono alara-tabular space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[#94A3B8]">
              Дальность <strong className="text-[#0EA5E9]">{effectiveReachM.toFixed(1)} м</strong> ·{' '}
              <strong className="text-[#F59E0B]">{currentSuit.thermalRatingC}°C</strong>
            </span>
            <button
              type="button"
              onClick={() => setShowDetails(prev => !prev)}
              className="text-[#0EA5E9] hover:text-sky-300 font-sans font-medium cursor-pointer whitespace-nowrap"
            >
              {showDetails ? 'Скрыть' : 'Подробнее ?'}
            </button>
          </div>

          {showDetails && (
            <div className="pt-2 border-t border-slate-400/15 space-y-1.5 text-[11px]">
              <p className="font-sans text-[#94A3B8] leading-snug">{currentSuit.descRu}</p>
              <p className="font-sans text-[#94A3B8] leading-snug">{currentResp.descRu}</p>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Свинец:</span>
                <span className="text-[#0EA5E9] font-semibold">{currentSuit.leadEquivalentMm} мм Pb</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">α / β / γ:</span>
                <span className="text-[#10B981] font-semibold">
                  {currentSuit.alphaBlockingPercent}% / ×{currentSuit.betaAttenuationFactor} / ×{currentSuit.gammaAttenuationFactor}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Фильтрация дыма:</span>
                <span className="text-[#14B8A6] font-semibold">
                  {currentResp.filtrationEfficiencyPercent}% (КЗ {currentResp.inhalationProtectionFactor})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#94A3B8]">Бонус роли:</span>
                <span style={{ color: currentRoleSpec.primaryColorHex }} className="font-semibold">
                  Скорость ×{currentRoleSpec.modifiers.holdActionSpeedMultiplier.toFixed(2)} · Тушение ×{currentRoleSpec.modifiers.fireSuppressionMultiplier.toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
