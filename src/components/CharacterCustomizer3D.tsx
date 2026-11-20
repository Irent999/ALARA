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
  Check,
  Sparkles,
  Layers,
  UserCheck
} from 'lucide-react';
import { InstrumentId, GOST_INSTRUMENTS } from '../instruments/gostInstruments';
import { RemoteToolId, REMOTE_TOOLS } from '../physics/gostPhysics';

export type SuitTypeId = 'none' | 'lead_apron' | 'l1_suit' | 'kih4_suit' | 'heavy_lead_armor';
export type RespiratorTypeId = 'none' | 'lepestok_200' | 'gp7_gasmask' | 'asv2_scba';

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
}

export const SUIT_DEFINITIONS: Record<SuitTypeId, {
  nameRu: string;
  descRu: string;
  leadEquivalentMm: number;
  alphaBlockingPercent: number;
  betaAttenuationFactor: number;
  gammaAttenuationFactor: number;
  colorHex: number;
  metalness: number;
  roughness: number;
}> = {
  none: {
    nameRu: 'Х/б Спецодежда (Лабораторный халат)',
    descRu: 'Базовая хлопчатобумажная форма без специальных экранирующих свойств. Задерживает только альфа-частицы при прямом оседании на ткань.',
    leadEquivalentMm: 0.0,
    alphaBlockingPercent: 95.0,
    betaAttenuationFactor: 1.05,
    gammaAttenuationFactor: 1.0,
    colorHex: 0xf1f5f9,
    metalness: 0.05,
    roughness: 0.9
  },
  lead_apron: {
    nameRu: 'Свинцовый фартук (0.50 мм Pb)',
    descRu: 'Медицинский рентгенозащитный фартук с виниловым свинцовым наполнителем для защиты гонад, щитовидной железы и кроветворных органов.',
    leadEquivalentMm: 0.50,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 5.5,
    gammaAttenuationFactor: 1.85,
    colorHex: 0x0284c7,
    metalness: 0.2,
    roughness: 0.5
  },
  l1_suit: {
    nameRu: 'Костюм защитный Л-1 (УКК)',
    descRu: 'Прорезиненный комбинезон с капюшоном, защитными чулками и перчатками. Полная защита от радиоактивной пыли и брызг.',
    leadEquivalentMm: 0.08,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 3.2,
    gammaAttenuationFactor: 1.1,
    colorHex: 0x4d7c0f,
    metalness: 0.15,
    roughness: 0.7
  },
  kih4_suit: {
    nameRu: 'Изолирующий комплекс КИХ-4',
    descRu: 'Герметичный скафандр высшего класса защиты с панорамным иллюминатором для работы в экстремальных аварийных зонах.',
    leadEquivalentMm: 0.25,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 8.0,
    gammaAttenuationFactor: 1.35,
    colorHex: 0xf59e0b,
    metalness: 0.3,
    roughness: 0.4
  },
  heavy_lead_armor: {
    nameRu: 'Тяжелый экранирующий комплект ликвидатора',
    descRu: 'Многослойный жилет и набедренники из свинцовых пластин толщиной 2.5 мм Pb для кратковременных операций в полях высокой мощности дозы.',
    leadEquivalentMm: 2.5,
    alphaBlockingPercent: 100.0,
    betaAttenuationFactor: 45.0,
    gammaAttenuationFactor: 3.8,
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
    descRu: 'Свободное дыхание атмосферным воздухом. Высокий риск ингаляционного поступления аэрозолей и радона.',
    filtrationEfficiencyPercent: 0.0,
    inhalationProtectionFactor: 1.0,
    colorHex: 0x000000
  },
  lepestok_200: {
    nameRu: 'Респиратор ШБ-1 «Лепесток-200»',
    descRu: 'Бесклапанный фильтрующий респиратор на материале ФПП-15. Эффективность задержания радиоактивных аэрозолей 99.9%.',
    filtrationEfficiencyPercent: 99.9,
    inhalationProtectionFactor: 200.0,
    colorHex: 0xffffff
  },
  gp7_gasmask: {
    nameRu: 'Противогаз ГП-7 с фильтром ФПК',
    descRu: 'Фильтрующий противогаз с резиновой маской и коробкой с активированным углем и аэрозольным фильтром (защита от паров и йода-131).',
    filtrationEfficiencyPercent: 99.98,
    inhalationProtectionFactor: 1000.0,
    colorHex: 0x1c1917
  },
  asv2_scba: {
    nameRu: 'Дыхательный аппарат АСВ-2 (Изолирующий)',
    descRu: 'Автономный аппарат со сжатым воздухом (300 бар) и панорамной маской избыточного давления. 100% изоляция от внешней среды.',
    filtrationEfficiencyPercent: 100.0,
    inhalationProtectionFactor: 10000.0,
    colorHex: 0x0284c7
  }
};

export const CharacterCustomizer3D: React.FC<CharacterCustomizer3DProps> = ({
  ppeState,
  onChangePPE,
  selectedRemoteToolId,
  onChangeRemoteTool
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const mannequinGroupRef = useRef<THREE.Group | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 460;
    const height = container.clientHeight || 420;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x070b14);

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 20);
    camera.position.set(0, 1.35, 2.85);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Студийный свет для демонстрации материалов СИЗ
    const ambientLight = new THREE.AmbientLight(0xffffff, 1.2);
    scene.add(ambientLight);

    const dirLight = new THREE.DirectionalLight(0xfffbeb, 2.5);
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

    // Световое кольцо на постаменте
    const ringGeo = new THREE.RingGeometry(0.70, 0.73, 36);
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, side: THREE.DoubleSide });
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
    let rotY = 0.25;
    let rotX = 0.05;
    let zoom = 2.85;

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
      zoom = Math.max(1.6, Math.min(4.5, zoom + e.deltaY * 0.002));
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

      camera.position.x = Math.sin(rotX) * 0.3;
      camera.position.y = 1.35 + Math.sin(rotX) * 0.6;
      camera.position.z = zoom;
      camera.lookAt(0, 1.15, 0);

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
      renderer.dispose();
    };
  }, []);

  // Перестроение геометрии манекена и экипировки при смене параметров
  useEffect(() => {
    const group = mannequinGroupRef.current;
    if (!group) return;

    while (group.children.length > 0) {
      group.remove(group.children[0]);
    }

    const suit = SUIT_DEFINITIONS[ppeState.suitId];
    const resp = RESPIRATOR_DEFINITIONS[ppeState.respiratorId];

    // Материал костюма
    const suitMat = new THREE.MeshStandardMaterial({
      color: suit.colorHex,
      roughness: suit.roughness,
      metalness: suit.metalness
    });

    // Материал открытой кожи / подкладки
    const skinMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      roughness: 0.6,
      metalness: 0.05
    });

    // 1. Ноги и сапоги
    const legGeo = new THREE.CylinderGeometry(0.09, 0.08, 0.85, 16);
    const leftLeg = new THREE.Mesh(legGeo, suitMat);
    leftLeg.position.set(-0.16, 0.52, 0);
    leftLeg.castShadow = true;
    group.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, suitMat);
    rightLeg.position.set(0.16, 0.52, 0);
    rightLeg.castShadow = true;
    group.add(rightLeg);

    const bootMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.4 });
    const bootGeo = new THREE.BoxGeometry(0.14, 0.12, 0.26);
    const leftBoot = new THREE.Mesh(bootGeo, bootMat);
    leftBoot.position.set(-0.16, 0.10, 0.04);
    group.add(leftBoot);

    const rightBoot = new THREE.Mesh(bootGeo, bootMat);
    rightBoot.position.set(0.16, 0.10, 0.04);
    group.add(rightBoot);

    // 2. Торс / Тело
    const torsoGeo = new THREE.BoxGeometry(0.48, 0.68, 0.28);
    const torso = new THREE.Mesh(torsoGeo, suitMat);
    torso.position.set(0, 1.25, 0);
    torso.castShadow = true;
    group.add(torso);

    // 3. Руки и перчатки
    const armGeo = new THREE.CylinderGeometry(0.07, 0.065, 0.62, 16);
    const leftArm = new THREE.Mesh(armGeo, suitMat);
    leftArm.position.set(-0.33, 1.25, 0);
    leftArm.rotation.z = 0.15;
    leftArm.castShadow = true;
    group.add(leftArm);

    const rightArm = new THREE.Mesh(armGeo, suitMat);
    rightArm.position.set(0.33, 1.25, 0.12);
    rightArm.rotation.x = -0.55;
    rightArm.rotation.z = -0.15;
    rightArm.castShadow = true;
    group.add(rightArm);

    // 4. Голова и шея
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.12, 16), skinMat);
    neck.position.set(0, 1.62, 0);
    group.add(neck);

    const headGeo = new THREE.SphereGeometry(0.14, 24, 24);
    const head = new THREE.Mesh(headGeo, skinMat);
    head.position.set(0, 1.76, 0);
    head.castShadow = true;
    group.add(head);

    // Особенности костюма (Фартук, Капюшон, Скафандр)
    if (ppeState.suitId === 'lead_apron') {
      const apronGeo = new THREE.BoxGeometry(0.44, 0.75, 0.06);
      const apronMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.3, metalness: 0.4 });
      const apron = new THREE.Mesh(apronGeo, apronMat);
      apron.position.set(0, 1.15, 0.13);
      group.add(apron);
    } else if (ppeState.suitId === 'kih4_suit') {
      const helmetGeo = new THREE.SphereGeometry(0.24, 24, 24);
      const helmetMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.3 });
      const helmet = new THREE.Mesh(helmetGeo, helmetMat);
      helmet.position.set(0, 1.76, 0);
      group.add(helmet);

      const visorGeo = new THREE.BoxGeometry(0.26, 0.16, 0.12);
      const visorMat = new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.1, metalness: 0.9, transparent: true, opacity: 0.75 });
      const visor = new THREE.Mesh(visorGeo, visorMat);
      visor.position.set(0, 1.78, 0.14);
      group.add(visor);
    }

    // 5. Защита дыхания (СИЗОД)
    if (ppeState.respiratorId === 'lepestok_200') {
      const maskGeo = new THREE.ConeGeometry(0.10, 0.09, 16);
      const maskMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
      const mask = new THREE.Mesh(maskGeo, maskMat);
      mask.rotation.x = Math.PI / 2;
      mask.position.set(0, 1.73, 0.14);
      group.add(mask);
    } else if (ppeState.respiratorId === 'gp7_gasmask') {
      const maskGeo = new THREE.SphereGeometry(0.15, 16, 16);
      const maskMat = new THREE.MeshStandardMaterial({ color: 0x1c1917, roughness: 0.8 });
      const mask = new THREE.Mesh(maskGeo, maskMat);
      mask.position.set(0, 1.76, 0.03);
      group.add(mask);

      const filterCanister = new THREE.Mesh(
        new THREE.CylinderGeometry(0.045, 0.045, 0.11, 16),
        new THREE.MeshStandardMaterial({ color: 0x3f6212, metalness: 0.6 })
      );
      filterCanister.position.set(-0.09, 1.66, 0.13);
      filterCanister.rotation.z = 0.35;
      group.add(filterCanister);
    } else if (ppeState.respiratorId === 'asv2_scba') {
      const tankGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.55, 16);
      const tankMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.8, roughness: 0.2 });
      const tank = new THREE.Mesh(tankGeo, tankMat);
      tank.position.set(0, 1.25, -0.22);
      group.add(tank);
    }

    // 6. Прибор в правой руке
    const instProfile = GOST_INSTRUMENTS[ppeState.instrumentId];
    const devBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.20, 0.07),
      new THREE.MeshStandardMaterial({ color: instProfile.model3dDetails.color, metalness: 0.5 })
    );
    devBox.position.set(0.33, 1.0, 0.28);
    devBox.rotation.x = -0.3;
    group.add(devBox);
  }, [ppeState]);

  return (
    <div className="flex flex-col lg:flex-row gap-5 items-stretch w-full">
      {/* 3D Сцена манекена */}
      <div className="relative flex-1 min-h-[380px] rounded-2xl overflow-hidden border border-slate-800 bg-slate-950 flex items-center justify-center">
        <div ref={mountRef} className="w-full h-full cursor-grab active:cursor-grabbing" />
        <div className="absolute top-3 left-3 bg-slate-900/80 backdrop-blur border border-slate-700/60 rounded-xl px-3 py-1.5 text-xs text-slate-300 pointer-events-none flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5 text-sky-400" />
          <span>Вращайте манекен мышью (360° CAD View)</span>
        </div>
      </div>

      {/* Панель переключения СИЗ и прибора */}
      <div className="w-full lg:w-96 flex flex-col gap-3 text-xs">
        
        {/* Выбор защитного костюма */}
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <label className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Shield className="w-4 h-4 text-sky-400" />
            <span>Защитный костюм (СИЗ тела):</span>
          </label>
          <select
            value={ppeState.suitId}
            onChange={e => onChangePPE({ ...ppeState, suitId: e.target.value as SuitTypeId })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-cyan-300 font-mono font-semibold"
          >
            {Object.entries(SUIT_DEFINITIONS).map(([id, s]) => (
              <option key={id} value={id}>
                {s.nameRu} ({s.leadEquivalentMm > 0 ? `${s.leadEquivalentMm} мм Pb` : 'х/б'})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 leading-normal">
            {SUIT_DEFINITIONS[ppeState.suitId].descRu}
          </p>
        </div>

        {/* Выбор защиты дыхания (СИЗОД) */}
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <label className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Eye className="w-4 h-4 text-emerald-400" />
            <span>Защита органов дыхания (СИЗОД):</span>
          </label>
          <select
            value={ppeState.respiratorId}
            onChange={e => onChangePPE({ ...ppeState, respiratorId: e.target.value as RespiratorTypeId })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-emerald-300 font-mono font-semibold"
          >
            {Object.entries(RESPIRATOR_DEFINITIONS).map(([id, r]) => (
              <option key={id} value={id}>
                {r.nameRu} (К_защ = {r.inhalationProtectionFactor})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 leading-normal">
            {RESPIRATOR_DEFINITIONS[ppeState.respiratorId].descRu}
          </p>
        </div>

        {/* Выбор дозиметрического прибора в руке */}
        <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
          <label className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-amber-400" />
            <span>Прибор в руке дозиметриста:</span>
          </label>
          <select
            value={ppeState.instrumentId}
            onChange={e => onChangePPE({ ...ppeState, instrumentId: e.target.value as InstrumentId })}
            className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-amber-300 font-mono font-semibold"
          >
            {Object.values(GOST_INSTRUMENTS).map(inst => (
              <option key={inst.id} value={inst.id}>
                {inst.name} ({inst.detectedRadiation.join(', ')})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-slate-400 leading-normal">
            {GOST_INSTRUMENTS[ppeState.instrumentId].nameFull}
          </p>
        </div>

        {/* Выбор дистанционного инструмента / манипулятора */}
        {onChangeRemoteTool && (
          <div className="p-3.5 rounded-xl bg-slate-900/80 border border-slate-800 space-y-2">
            <label className="font-bold text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-sky-400" />
              <span>Дистанционный инструмент (Защита расстоянием):</span>
            </label>
            <select
              value={selectedRemoteToolId || 'hand'}
              onChange={e => onChangeRemoteTool(e.target.value as RemoteToolId)}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sky-300 font-mono font-semibold"
            >
              {Object.values(REMOTE_TOOLS).map(tool => (
                <option key={tool.id} value={tool.id}>
                  {tool.nameRu}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 leading-normal">
              {REMOTE_TOOLS[selectedRemoteToolId || 'hand']?.descriptionRu}
            </p>
          </div>
        )}

        {/* Метрологическая карточка суммарной защиты */}
        <div className="p-3 rounded-xl bg-cyan-950/30 border border-cyan-800/40 text-[11px] font-mono space-y-1">
          <div className="flex justify-between">
            <span className="text-slate-400">Свинцовый эквивалент:</span>
            <span className="text-cyan-300 font-bold">{SUIT_DEFINITIONS[ppeState.suitId].leadEquivalentMm} мм Pb</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Задержка альфа-потока:</span>
            <span className="text-emerald-300 font-bold">{SUIT_DEFINITIONS[ppeState.suitId].alphaBlockingPercent}%</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Коэф. ослабления бета (K_β):</span>
            <span className="text-cyan-300 font-bold">×{SUIT_DEFINITIONS[ppeState.suitId].betaAttenuationFactor}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-400">Коэф. ослабления гамма (K_γ):</span>
            <span className="text-amber-300 font-bold">×{SUIT_DEFINITIONS[ppeState.suitId].gammaAttenuationFactor}</span>
          </div>
        </div>

      </div>
    </div>
  );
};
