/**
 * ALARA-Planner Pro VR — Визуализатор источников ионизирующего излучения
 * (src/scene/radiationSourceVisualizer.ts)
 *
 * Делает источники радиации на 3D-сцене наглядными и понятными:
 * 1. Промышленные контейнеры и ампулы для «невидимых» источников (свинцовый контейнер УКТ, коллиматор, ампула).
 * 2. 3D-голографические маркеры радиационной опасности (Знак радиации ГОСТ 17925-72, радионуклид, активность в ГБк/МБк, тип излучения).
 * 3. Пульсирующие зоны ионизационного свечения (эффект Черенкова / ионизация воздуха).
 * 4. Концентрические кольца полей доз (изодозы опасных зон ALARA) на полу.
 */

import * as THREE from 'three';
import { RadiationSourceInstance } from './scenarios';
import { ISOTOPE_DATABASE, IsotopeData } from '../physics/gostPhysics';

interface VisualSourceItem {
  source: RadiationSourceInstance;
  hologramGroup: THREE.Group;
  haloMesh: THREE.Mesh;
  ringsGroup: THREE.Group;
  initialY: number;
}

export class RadiationSourceVisualizer {
  private items: VisualSourceItem[] = [];
  public rootGroup: THREE.Group;
  private animTime = 0;
  public visible = true;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'radiation_sources_visualizer_root';
  }

  /**
   * Привязка источников радиации сцены и генерация 3D-маркеров
   */
  public bindSources(sources: RadiationSourceInstance[], envGroup: THREE.Group): void {
    this.clear();

    for (const src of sources) {
      const isoData: IsotopeData | undefined = ISOTOPE_DATABASE[src.isotopeId];

      // 1. Если у источника нет физического меша, создаем аутентичный свинцовый контейнер или ампулу
      if (!src.mesh) {
        const physicalContainer = this.createPhysicalSourceMesh(src, isoData);
        physicalContainer.position.copy(src.position);
        envGroup.add(physicalContainer);
        src.mesh = physicalContainer;
      }

      // 2. Голографический знак радиационной опасности ГОСТ 17925-72
      const hologram = this.createHolographicBadge(src, isoData);
      hologram.position.copy(src.position);
      hologram.position.y += 0.42; // Парит над источником
      this.rootGroup.add(hologram);

      // 3. Зона ионизационного свечения (Черенковское свечение / ионизация)
      const halo = this.createIonizationHalo(src, isoData);
      halo.position.copy(src.position);
      this.rootGroup.add(halo);

      // 4. Проекционные кольца зон доз на полу / поверхности модели
      const rings = this.createIsodoseRings(src);
      rings.position.set(src.position.x, src.ringFloorY ?? 0.02, src.position.z);
      this.rootGroup.add(rings);

      this.items.push({
        source: src,
        hologramGroup: hologram,
        haloMesh: halo,
        ringsGroup: rings,
        initialY: src.position.y + 0.42
      });
    }

    envGroup.add(this.rootGroup);
  }

  /**
   * Создает физический промышленный контейнер / капсулу для источников без собственного меша
   */
  private createPhysicalSourceMesh(src: RadiationSourceInstance, iso?: IsotopeData): THREE.Group {
    const group = new THREE.Group();
    group.name = `physical_src_container_${src.id}`;

    // Свинцовый защитный контейнер КЛ-3 / УКТ
    const bodyGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.16, 20);
    const leadMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      metalness: 0.8,
      roughness: 0.35
    });
    const body = new THREE.Mesh(bodyGeo, leadMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

    // Желтая предупреждающая полоса ГОСТ
    const stripeGeo = new THREE.CylinderGeometry(0.082, 0.082, 0.04, 20);
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xfacc15,
      metalness: 0.2,
      roughness: 0.5
    });
    const stripe = new THREE.Mesh(stripeGeo, stripeMat);
    stripe.position.y = 0.02;
    group.add(stripe);

    // Ручка для дистанционного манипулятора
    const handleCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.05, 0.08, 0),
      new THREE.Vector3(-0.05, 0.14, 0),
      new THREE.Vector3(0.05, 0.14, 0),
      new THREE.Vector3(0.05, 0.08, 0)
    ]);
    const handleGeo = new THREE.TubeGeometry(handleCurve, 16, 0.007, 8, false);
    const handleMat = new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.9,
      roughness: 0.2
    });
    const handle = new THREE.Mesh(handleGeo, handleMat);
    group.add(handle);

    // Активная ампула внутри / на вершине
    const isNeutronCore =
      iso?.radiationType === 'fast_neutron' ||
      iso?.radiationType === 'thermal_neutron' ||
      (iso?.emissionShares?.neutron ?? 0) > 0;
    const isGammaCore = iso?.radiationType === 'gamma' || (iso?.emissionShares?.gamma ?? 0) > 0;
    const coreGeo = new THREE.SphereGeometry(0.018, 16, 16);
    const coreColor = isNeutronCore
      ? 0x38bdf8
      : isGammaCore
      ? 0x60a5fa
      : 0xf59e0b;
    const coreMat = new THREE.MeshStandardMaterial({
      color: coreColor,
      emissive: new THREE.Color(coreColor),
      emissiveIntensity: 1.2,
      roughness: 0.1
    });
    const core = new THREE.Mesh(coreGeo, coreMat);
    core.position.y = 0.09;
    group.add(core);

    return group;
  }

  /**
   * Создает 3D-голографический маркер с информацией о радионуклиде и знаке радиации
   */
  private createHolographicBadge(src: RadiationSourceInstance, iso?: IsotopeData): THREE.Group {
    const group = new THREE.Group();
    group.name = `hologram_${src.id}`;

    // Создаем Canvas высокого разрешения для четкого рендеринга текста и знака
    const canvas = document.createElement('canvas');
    canvas.width = 512;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;

    // Полупрозрачный голографический фон со скруглением
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 240, 24);
    ctx.fill();

    // Неоновая неограниченная рамка
    const isNeutron =
      iso?.radiationType === 'fast_neutron' ||
      iso?.radiationType === 'thermal_neutron' ||
      (iso?.emissionShares?.neutron ?? 0) > 0;
    const isGamma = iso?.radiationType === 'gamma' || (iso?.emissionShares?.gamma ?? 0) > 0;
    const borderColor = isNeutron ? '#38bdf8' : isGamma ? '#facc15' : '#fb923c';

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.roundRect(8, 8, 496, 240, 24);
    ctx.stroke();

    // Рисуем знак радиационной опасности (ГОСТ 17925-72 Трефойл)
    const centerX = 80;
    const centerY = 128;
    const r = 48;

    ctx.fillStyle = borderColor;
    // Центральный кружок
    ctx.beginPath();
    ctx.arc(centerX, centerY, r * 0.24, 0, Math.PI * 2);
    ctx.fill();

    // 3 лепестка под углами 0°, 120°, 240°
    for (let i = 0; i < 3; i++) {
      const angle = (i * 120 - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.arc(centerX, centerY, r, angle - 0.52, angle + 0.52);
      ctx.arc(centerX, centerY, r * 0.40, angle + 0.52, angle - 0.52, true);
      ctx.closePath();
      ctx.fill();
    }

    // Текст: Название изотопа
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 52px sans-serif';
    ctx.fillText(src.isotopeId, 170, 84);

    // Текст: Активность
    const actStr =
      src.activityMBq >= 1000
        ? `${(src.activityMBq / 1000).toFixed(1)} ГБк`
        : `${src.activityMBq} МБк`;
    ctx.fillStyle = borderColor;
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`А = ${actStr}`, 170, 140);

    // Текст: Тип излучения
    let typesStr = 'ИИИ';
    if (iso) {
      if (iso.radiationType === 'fast_neutron' || iso.radiationType === 'thermal_neutron') {
        typesStr = 'n-нейтроны + γ';
      } else if (iso.radiationType === 'gamma') {
        typesStr = 'γ-гамма (ГОСТ)';
      } else if (iso.radiationType === 'beta') {
        typesStr = 'β-бета';
      } else if (iso.radiationType === 'alpha') {
        typesStr = 'α-альфа';
      }
    }

    ctx.fillStyle = '#94a3b8';
    ctx.font = '22px sans-serif';
    ctx.fillText(typesStr, 170, 190);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;

    const planeGeo = new THREE.PlaneGeometry(0.50, 0.25);
    const planeMat = new THREE.MeshBasicMaterial({
      map: texture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
      depthWrite: false
    });
    const planeMesh = new THREE.Mesh(planeGeo, planeMat);
    group.add(planeMesh);

    // Светодиодная стойка-луч, указывающая на источник
    const lineGeo = new THREE.CylinderGeometry(0.003, 0.003, 0.35, 8);
    const lineMat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(borderColor),
      transparent: true,
      opacity: 0.65
    });
    const lineMesh = new THREE.Mesh(lineGeo, lineMat);
    lineMesh.position.y = -0.20;
    group.add(lineMesh);

    return group;
  }

  /**
   * Создает полупрозрачную сферу ионизационного свечения вокруг источника
   */
  private createIonizationHalo(src: RadiationSourceInstance, iso?: IsotopeData): THREE.Mesh {
    const isNeutron =
      iso?.radiationType === 'fast_neutron' ||
      iso?.radiationType === 'thermal_neutron' ||
      (iso?.emissionShares?.neutron ?? 0) > 0;
    const isGamma = iso?.radiationType === 'gamma' || (iso?.emissionShares?.gamma ?? 0) > 0;
    const colorHex = isNeutron ? 0x38bdf8 : isGamma ? 0x0284c7 : 0xf59e0b;

    // Радиус зависит от логарифма активности
    const baseRadius = 0.20 + Math.min(0.45, Math.log10(Math.max(10, src.activityMBq)) * 0.08);

    const geo = new THREE.SphereGeometry(baseRadius, 24, 24);
    const mat = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0.18,
      blending: THREE.AdditiveBlending,
      side: THREE.BackSide,
      depthWrite: false
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `ionization_halo_${src.id}`;
    return mesh;
  }

  /**
   * Концентрические кольца изодоз на полу вокруг источника
   */
  private createIsodoseRings(src: RadiationSourceInstance): THREE.Group {
    const group = new THREE.Group();
    group.name = `isodose_rings_${src.id}`;

    // Внутреннее кольцо: Зона жесткой опасности (> 1000 мкЗв/ч)
    const innerRingGeo = new THREE.RingGeometry(0.35, 0.37, 32);
    innerRingGeo.rotateX(-Math.PI / 2);
    const innerMat = new THREE.MeshBasicMaterial({
      color: 0xef4444,
      transparent: true,
      opacity: 0.45,
      side: THREE.DoubleSide
    });
    const innerRing = new THREE.Mesh(innerRingGeo, innerMat);
    group.add(innerRing);

    // Внешнее кольцо: Зона радиационного контроля (> 100 мкЗв/ч)
    const outerRingGeo = new THREE.RingGeometry(0.85, 0.87, 32);
    outerRingGeo.rotateX(-Math.PI / 2);
    const outerMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      transparent: true,
      opacity: 0.35,
      side: THREE.DoubleSide
    });
    const outerRing = new THREE.Mesh(outerRingGeo, outerMat);
    group.add(outerRing);

    return group;
  }

  /**
   * Обновление анимации в главном цикле (покачивание бейджей, ориентация на камеру, дыхание ореола)
   */
  public update(dt: number, camera: THREE.Camera): void {
    if (!this.visible || this.items.length === 0) return;

    this.animTime += dt;
    const bobOffset = Math.sin(this.animTime * 2.2) * 0.025;
    const pulseScale = 1.0 + Math.sin(this.animTime * 3.0) * 0.08;

    for (const item of this.items) {
      // Покачивание по высоте
      item.hologramGroup.position.y = item.initialY + bobOffset;

      // Ориентация голографического бейджа на камеру оператора (Billboard)
      item.hologramGroup.quaternion.copy(camera.quaternion);

      // Пульсация ореола ионизационного свечения
      item.haloMesh.scale.set(pulseScale, pulseScale, pulseScale);
    }
  }

  /**
   * Переключение видимости маркеров
   */
  public setVisible(val: boolean): void {
    this.visible = val;
    this.rootGroup.visible = val;
  }

  /**
   * Очистка созданных ресурсов
   */
  public clear(): void {
    while (this.rootGroup.children.length > 0) {
      const child = this.rootGroup.children[0];
      this.rootGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry?.dispose();
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material?.dispose();
        }
      }
    }
    this.items = [];
  }
}
