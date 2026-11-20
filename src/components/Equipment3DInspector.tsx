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
      <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-900/90 p-3 rounded-xl border border-slate-800">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            onClick={() => setInspectTarget('hand_rig')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              inspectTarget === 'hand_rig'
                ? 'bg-yellow-500 text-black'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Перчатка СИЗ + Дозиметр ГОСТ
          </button>
          <button
            onClick={() => setInspectTarget('tk6_container')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              inspectTarget === 'tk6_container'
                ? 'bg-yellow-500 text-black'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Контейнер ТК-6 (60 мм Pb)
          </button>
          <button
            onClick={() => setInspectTarget('vver_valve')}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition whitespace-nowrap ${
              inspectTarget === 'vver_valve'
                ? 'bg-yellow-500 text-black'
                : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
            }`}
          >
            Клапан ВВЭР + Манометр ГОСТ 2405
          </button>
        </div>

        {/* Макро-ракурсы для проверки геометрической и оптической точности */}
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
                className={`px-2.5 py-1 rounded-lg text-[11px] font-medium transition whitespace-nowrap ${
                  cameraPreset === preset
                    ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40'
                    : 'bg-slate-800/70 text-slate-400 hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Основной 3D-вьюпорт с интерактивным вращением */}
      <div className="relative w-full h-[320px] rounded-xl overflow-hidden border border-slate-800 bg-slate-950">
        <div
          ref={mountRef}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          title="Зажмите ЛКМ для вращения 3D-модели на 360°, колесико мыши — масштаб"
        />

        {/* Спецификация физического рендеринга (чистая типографика без капсул) */}
        <div className="absolute top-3 left-3 pointer-events-none bg-slate-950/75 backdrop-blur-sm px-3 py-2 rounded-lg border border-white/10 text-[11px] text-slate-300 space-y-0.5 font-mono tabular-nums">
          <div className="text-yellow-400 font-semibold">
            PBR & CAD Телеметрия · ACESFilmic (Exp 1.0) · sRGB · PCFSoftShadow
          </div>
          <div>
            Фаски R = 1.0–3.0 мм · Корпус Roughness = 0.45 · Контакты Metalness = 0.9 / Roughness = 0.2
          </div>
          <div>
            Оптика: Стекло IOR 1.52 · AR Iridescence 1.38 · Глубина LCD 2.2 мм · Кабель y = a·cosh(x/a)
          </div>
        </div>

        {/* Кнопка переключения каркасной сетки фасок */}
        <button
          onClick={() => setWireframeOverlay(w => !w)}
          className={`absolute top-3 right-3 px-3 py-1.5 rounded-lg text-xs font-semibold border transition flex items-center gap-1.5 ${
            wireframeOverlay
              ? 'bg-emerald-500 text-black border-emerald-400'
              : 'bg-slate-900/85 text-slate-200 border-slate-700 hover:bg-slate-800'
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span>{wireframeOverlay ? 'PBR Режим' : 'Сетка фасок (Wireframe)'}</span>
        </button>
      </div>

      {/* Нижняя панель интерактивного тестирования зондов, хвата перчатки и ЖК-экрана */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 bg-slate-900/80 p-3 rounded-xl border border-slate-800 text-xs">
        <div>
          <label className="text-slate-400 block mb-1 font-medium">
            Сменный первичный детектор (ГОСТ 27451-87):
          </label>
          <div className="flex gap-1">
            {(['dp5', 'ion', 'nai', 'neutron'] as InstrumentId[]).map(id => (
              <button
                key={id}
                onClick={() => onSelectInstrument(id)}
                className={`px-2.5 py-1.5 rounded-lg font-bold transition flex-1 whitespace-nowrap ${
                  selectedInstrumentId === id
                    ? 'bg-yellow-500 text-black'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
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
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Анатомический сгиб пальцев СИЗ:</span>
            <span className="font-mono text-white tabular-nums">{Math.round(gripCurl * 100)}%</span>
          </div>
          <input
            type="range"
            min={0}
            max={1}
            step={0.02}
            value={gripCurl}
            onChange={e => setGripCurl( parseFloat(e.target.value) )}
            className="w-full accent-yellow-500 cursor-pointer"
          />
        </div>

        <div>
          <div className="flex justify-between text-slate-400 mb-1">
            <span>Тест индикации ЖК-матрицы:</span>
            <span className="font-mono text-emerald-400 tabular-nums">{simulatedDose.toFixed(1)} мкЗв/ч</span>
          </div>
          <input
            type="range"
            min={0.2}
            max={2500}
            step={0.5}
            value={simulatedDose}
            onChange={e => setSimulatedDose( parseFloat(e.target.value) )}
            className="w-full accent-emerald-500 cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};
