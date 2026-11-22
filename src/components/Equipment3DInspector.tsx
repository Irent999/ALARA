/**
 * ALARA-Planner Pro VR — Интерактивный 3D CAD/PBR Инспектор ядерного оборудования
 * Позволяет исследовать субмиллиметровые фаски (R ≈ 1–3 мм), многослойную оптику Френеля/AR,
 * подповерхностное рассеивание (SSS) перчаток СИЗ и кабели цепной линии при HDRI-освещении.
 */

import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RotateCcw, Eye, Sparkles, Sliders, Maximize2 } from 'lucide-react';
import { HazmatHandRig } from '../scene/handModel';
import { createTK6Container, createHighDetailValve } from '../scene/proceduralModels';
import { configurePhotorealisticRendererAndHDRI } from '../scene/pbrMaterialEngine';
import { InstrumentId } from '../instruments/gostInstruments';

interface Equipment3DInspectorProps {
  selectedInstrumentId: InstrumentId;
  onSelectInstrument: (id: InstrumentId) => void;
}

type InspectTarget = 'hand_rig' | 'tk6_container' | 'vver_valve';
type CameraPreset = 'overview' | 'optics_macro' | 'glove_sss' | 'catenary_cable';

export const Equipment3DInspector: React.FC<Equipment3DInspectorProps> = ({
  selectedInstrumentId,
  onSelectInstrument
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [inspectTarget, setInspectTarget] = useState<InspectTarget>('hand_rig');
  const [cameraPreset, setCameraPreset] = useState<CameraPreset>('overview');
  const [gripCurl, setGripCurl] = useState<number>(0.25);
  const [wireframeOverlay, setWireframeOverlay] = useState<boolean>(false);
  const [simulatedDose, setSimulatedDose] = useState<number>(14.8);

  const handRigRef = useRef<HazmatHandRig | null>(null);
  const stageGroupRef = useRef<THREE.Group | null>(null);
  const targetCamPosRef = useRef<THREE.Vector3>(new THREE.Vector3(0.22, 0.16, 0.34));
  const targetLookAtRef = useRef<THREE.Vector3>(new THREE.Vector3(0, 0.01, -0.48));

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || 720;
    const height = container.clientHeight || 400;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1120);

    const camera = new THREE.PerspectiveCamera(42, width / height, 0.01, 25);
    camera.position.set(0.22, 0.16, 0.34);

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    // Настройка THREE.SRGBColorSpace, ACESFilmicToneMapping (exposure = 1.0), PCFSoftShadowMap и HDRI окружения
    const envTex = configurePhotorealisticRendererAndHDRI(renderer, scene);

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Трехточечное студийное освещение с мягкими тенями PCFSoftShadowMap
    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.2);
    keyLight.position.set(1.5, 2.4, 1.8);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.bias = -0.0002;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xbae6fd, 1.1);
    fillLight.position.set(-1.8, 1.0, 1.2);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
    rimLight.position.set(0, 1.4, -2.0);
    scene.add(rimLight);

    const stageGroup = new THREE.Group();
    scene.add(stageGroup);
    stageGroupRef.current = stageGroup;

    // Интерактивное вращение и зум мышью
    let isDragging = false;
    let prevX = 0;
    let prevY = 0;
    let rotY = 0.45;
    let rotX = 0.18;
    let zoomScale = 1.0;

    const onDown = (e: MouseEvent) => {
      isDragging = true;
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onUp = () => {
      isDragging = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!isDragging) return;
      rotY += (e.clientX - prevX) * 0.008;
      rotX = Math.max(-1.1, Math.min(1.1, rotX + (e.clientY - prevY) * 0.008));
      prevX = e.clientX;
      prevY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      zoomScale = Math.max(0.45, Math.min(2.2, zoomScale + e.deltaY * 0.001));
    };

    const domElem = renderer.domElement;
    domElem.addEventListener('mousedown', onDown);
    window.addEventListener('mouseup', onUp);
    window.addEventListener('mousemove', onMove);
    domElem.addEventListener('wheel', onWheel, { passive: false });

    let animId = 0;
    let lastTime = performance.now();
    const currentLookAt = new THREE.Vector3(0, 0, 0);

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min(0.05, (now - lastTime) / 1000);
      lastTime = now;

      if (stageGroupRef.current) {
        stageGroupRef.current.rotation.y += (rotY - stageGroupRef.current.rotation.y) * 0.14;
        stageGroupRef.current.rotation.x += (rotX - stageGroupRef.current.rotation.x) * 0.14;
      }

      if (handRigRef.current) {
        handRigRef.current.update(dt, true);
      }

      const desiredPos = targetCamPosRef.current.clone().multiplyScalar(zoomScale);
      camera.position.lerp(desiredPos, 0.12);
      currentLookAt.lerp(targetLookAtRef.current, 0.12);
      camera.lookAt(currentLookAt);

      renderer.render(scene, camera);
    };
    animate();

    const handleResize = () => {
      if (!mountRef.current) return;
      const w = mountRef.current.clientWidth || 720;
      const h = mountRef.current.clientHeight || 400;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      cancelAnimationFrame(animId);
      domElem.removeEventListener('mousedown', onDown);
      window.removeEventListener('mouseup', onUp);
      window.removeEventListener('mousemove', onMove);
      domElem.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', handleResize);
      envTex.dispose();
      renderer.dispose();
    };
  }, []);

  // Перестроение инспектируемой 3D-модели при смене объекта или прибора
  useEffect(() => {
    const stage = stageGroupRef.current;
    if (!stage) return;

    while (stage.children.length > 0) {
      stage.remove(stage.children[0]);
    }
    handRigRef.current = null;

    if (inspectTarget === 'hand_rig') {
      const rig = new HazmatHandRig({ handedness: 'right', withRadiometer: true });
      rig.rootGroup.position.set(0, 0, 0.04);
      rig.rootGroup.rotation.set(0, 0, 0);
      rig.setFingerCurl(gripCurl);
      rig.renderLCD(simulatedDose, selectedInstrumentId);
      stage.add(rig.rootGroup);
      handRigRef.current = rig;
    } else if (inspectTarget === 'tk6_container') {
      const tk6 = createTK6Container();
      tk6.position.set(0, -0.26, 0);
      stage.add(tk6);
    } else if (inspectTarget === 'vver_valve') {
      const valve = createHighDetailValve();
      valve.scale.set(0.48, 0.48, 0.48);
      valve.position.set(0, -0.15, 0);
      stage.add(valve);
    }

    // Применение wireframe-режима при включенной сетке контроля фасок
    stage.traverse(obj => {
      if ((obj as THREE.Mesh).isMesh) {
        const mesh = obj as THREE.Mesh;
        const mat = mesh.material;
        if (Array.isArray(mat)) {
          mat.forEach(m => {
            if ('wireframe' in m) (m as THREE.MeshStandardMaterial).wireframe = wireframeOverlay;
          });
        } else if (mat && 'wireframe' in mat) {
          (mat as THREE.MeshStandardMaterial).wireframe = wireframeOverlay;
        }
      }
    });
  }, [inspectTarget, selectedInstrumentId, wireframeOverlay]);

  // Обновление хвата и показаний ЖК-экрана в реальном времени
  useEffect(() => {
    if (handRigRef.current) {
      handRigRef.current.setFingerCurl(gripCurl);
      handRigRef.current.renderLCD(simulatedDose, selectedInstrumentId);
    }
  }, [gripCurl, simulatedDose, selectedInstrumentId]);

  // Переключение макро-ракурсов камеры
  useEffect(() => {
    if (inspectTarget !== 'hand_rig') {
      targetCamPosRef.current.set(0.55, 0.35, 0.72);
      targetLookAtRef.current.set(0, 0.02, 0);
      return;
    }

    if (cameraPreset === 'overview') {
      targetCamPosRef.current.set(0.24, 0.16, 0.28);
      targetLookAtRef.current.set(0, 0.01, -0.05);
    } else if (cameraPreset === 'optics_macro') {
      // Макро-наезд на многослойный ЖК-дисплей с AR-покрытием и внутренним колодцем 2.2 мм
      targetCamPosRef.current.set(0.06, 0.12, 0.05);
      targetLookAtRef.current.set(0, 0.03, -0.05);
    } else if (cameraPreset === 'glove_sss') {
      // Макро-наезд на анатомическую перчатку с подповерхностным рассеиванием (SSS) и байонетным кольцом
      targetCamPosRef.current.set(-0.20, 0.10, 0.16);
      targetLookAtRef.current.set(0, 0.0, 0.04);
    } else if (cameraPreset === 'catenary_cable') {
      // Макро-наезд на разъем LEMO (metalness=0.9, roughness=0.2) и цепную линию кабеля y = a*cosh(x/a)
      targetCamPosRef.current.set(-0.12, 0.07, -0.08);
      targetLookAtRef.current.set(0, 0.02, -0.14);
    }
  }, [cameraPreset, inspectTarget]);

  return (
    <div className="flex flex-col gap-3">
      {/* Верхняя панель переключения объектов и макро-ракурсов */}
      <div className="flex flex-wrap items-center justify-between gap-2 alara-surface p-3 rounded-xl">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setInspectTarget('hand_rig')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              inspectTarget === 'hand_rig'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'bg-[#0B1117] text-[#94A3B8] hover:text-[#F1F5F9] border border-slate-400/15'
            }`}
          >
            Перчатка СИЗ + Дозиметр ГОСТ
          </button>
          <button
            onClick={() => setInspectTarget('tk6_container')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              inspectTarget === 'tk6_container'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'bg-[#0B1117] text-[#94A3B8] hover:text-[#F1F5F9] border border-slate-400/15'
            }`}
          >
            Контейнер ТК-6 (60 мм Pb)
          </button>
          <button
            onClick={() => setInspectTarget('vver_valve')}
            className={`px-3 py-1.5 rounded-[10px] text-xs font-semibold transition whitespace-nowrap cursor-pointer ${
              inspectTarget === 'vver_valve'
                ? 'bg-[#0EA5E9] text-[#0B1117]'
                : 'bg-[#0B1117] text-[#94A3B8] hover:text-[#F1F5F9] border border-slate-400/15'
            }`}
          >
            Клапан ВВЭР + Манометр ГОСТ 2405
          </button>
        </div>

        {inspectTarget === 'hand_rig' && (
          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                ['overview', 'Общий план'],
                ['optics_macro', 'Макро: Оптика AR/Fresnel'],
                ['glove_sss', 'Макро: Перчатка SSS'],
                ['catenary_cable', 'Макро: Кабель Catenary & LEMO']
              ] as [CameraPreset, string][]
            ).map(([preset, label]) => (
              <button
                key={preset}
                onClick={() => setCameraPreset(preset)}
                className={`px-2.5 py-1 rounded-[10px] text-[11px] font-medium transition whitespace-nowrap cursor-pointer ${
                  cameraPreset === preset
                    ? 'bg-[#14B8A6]/15 text-[#14B8A6] border border-[#14B8A6]/40'
                    : 'bg-[#0B1117] text-[#94A3B8] hover:text-[#F1F5F9]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Основной 3D-вьюпорт */}
      <div className="relative w-full h-[320px] rounded-xl overflow-hidden border border-slate-400/15 bg-[#0B1117]">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          title="Зажмите ЛКМ для вращения 3D-модели на 360°, колесико мыши — масштаб"
        />

        <div className="absolute top-3 left-3 pointer-events-none alara-glass px-3 py-2 rounded-[10px] text-[11px] text-[#94A3B8] space-y-0.5 font-mono alara-tabular">
          <div className="text-[#F59E0B] font-semibold">
            PBR & CAD Телеметрия · ACESFilmic · sRGB · PCFSoftShadow
          </div>
          <div>
            Фаски R = 1.0–3.0 мм · Roughness = 0.45 · Контакты Metalness = 0.9 / Roughness = 0.2
          </div>
          <div>
            Оптика: Стекло IOR 1.52 · AR 1.38 · LCD 2.2 мм · Кабель y = a·cosh(x/a)
          </div>
        </div>

        <button
          onClick={() => setWireframeOverlay(w => !w)}
          className={`absolute top-3 right-3 px-3 py-1.5 rounded-[10px] text-xs font-semibold transition flex items-center gap-1.5 cursor-pointer ${
            wireframeOverlay
              ? 'bg-[#10B981] text-[#0B1117]'
              : 'alara-glass hover:bg-slate-800/80 text-[#F1F5F9]'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{wireframeOverlay ? 'PBR Режим' : 'Сетка фасок (Wireframe)'}</span>
        </button>
      </div>

      {/* Нижняя панель интерактивного тестирования */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 alara-surface p-3 rounded-xl text-xs">
        <div>
          <label className="text-[#94A3B8] block mb-1.5 font-medium">
            Сменный детектор (ГОСТ 27451-87):
          </label>
          <div className="flex gap-1">
            {(['dp5', 'ion', 'nai', 'neutron'] as InstrumentId[]).map(id => (
              <button
                key={id}
                onClick={() => onSelectInstrument(id)}
                className={`px-2.5 py-1.5 rounded-[10px] font-semibold transition flex-1 whitespace-nowrap cursor-pointer ${
                  selectedInstrumentId === id
                    ? 'bg-[#0EA5E9] text-[#0B1117]'
                    : 'bg-[#0B1117] text-[#94A3B8] hover:text-[#F1F5F9] border border-slate-400/15'
                }`}
              >
                {id === 'dp5' && 'СБМ-20'}
                {id === 'ion' && 'ДРГЗ'}
                {id === 'nai' && 'NaI(Tl)'}
                {id === 'neutron' && 'Боннер'}
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="flex justify-between text-[#94A3B8] mb-1.5">
            <span>Сгиб пальцев СИЗ:</span>
            <span className="font-mono text-[#F1F5F9] alara-tabular">{Math.round(gripCurl * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={gripCurl}
            onChange={e => setGripCurl(parseFloat(e.target.value))}
            className="w-full accent-[#0EA5E9] cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-[#94A3B8] mb-1.5">
            <span>Тест ЖК-матрицы:</span>
            <span className="font-mono text-[#10B981] alara-tabular">{simulatedDose.toFixed(1)} мкЗв/ч</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={2500}
            step={0.5}
            value={simulatedDose}
            onChange={e => setSimulatedDose(parseFloat(e.target.value))}
            className="w-full accent-[#10B981] cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
