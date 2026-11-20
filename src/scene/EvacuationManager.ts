/**
 * ALARA-Planner Pro VR — Система эвакуации и изоляции опасных объектов (EvacuationManager.ts)
 *
 * Реализует:
 * - Учёт и эвакуацию опасных объектов (выпавший ТВЭЛ / ИИИ, повреждённый контейнер РАО, пострадавший манекен / блок).
 * - Правило ALARA на дистанционный захват: высокоактивные ИИИ (requiresTongs: true) должны
 *   захватываться строго дистанционными щипцами ЦМ-1.5 (слот 3); контактный захват фиксируется как нарушение.
 * - Динамическое обновление координат переносимого источника RadiationSourceInstance в реальном времени
 *   с пересчётом мощности дозы по закону обратных квадратов 1/r² и инерцией покачивания при ходьбе.
 * - Анимацию свинцового контейнера САР / Безопасной зоны (открытие крышки при приближении,
 *   фиксация объекта, снижение активности на 95% и индикация защиты).
 * - Сводную статистику операций и эвакуации для итогового дебрифинга (AAR / ALARA / PDF).
 */

import * as THREE from 'three';
import type { InteractiveObjectInstance, RadiationSourceInstance } from './scenarios';
import type { MchsToolId } from './ToolManager';
import { createEquipmentLabelTexture } from './mchsTextures';

export interface MchsMissionMetrics {
  operationsCompleted: number;
  extractedCount: number;
  totalExtractable: number;
  tongsCompliantExtractions: number;
  bareHandViolations: number;
  spillsDecontaminated: number;
  firesExtinguished: number;
  valvesClosed: number;
  breakersSwitched: number;
  bareHandViolationDetailsRu: string[];
}

export interface CarriedHazardInfo {
  item: InteractiveObjectInstance;
  linkedSource: RadiationSourceInstance | null;
  usedTongs: boolean;
  bareHandViolation: boolean;
  nearestDropZoneDistanceM: number | null;
}

/**
 * Создаёт процедурный 3D свинцовый контейнер САР с анимированной крышкой и подсвеченной зоной сброса.
 */
export function createLeadSarContainerDropZone(titleRu: string, subtitleRu: string): THREE.Group {
  const group = new THREE.Group();
  group.name = 'sar_drop_zone_container';

  const leadMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.42, metalness: 0.72 });
  const yellowHazardMat = new THREE.MeshStandardMaterial({ color: 0xeab308, roughness: 0.35, metalness: 0.2 });
  const innerMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.75, metalness: 0.35 });

  // Маркированная напольная зона выгрузки
  const floorPad = new THREE.Mesh(
    new THREE.RingGeometry(0.95, 1.15, 48),
    new THREE.MeshBasicMaterial({
      color: 0x10b981,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide
    })
  );
  floorPad.rotation.x = -Math.PI / 2;
  floorPad.position.y = 0.018;
  group.add(floorPad);

  const innerPad = new THREE.Mesh(
    new THREE.CircleGeometry(0.94, 40),
    new THREE.MeshBasicMaterial({
      color: 0x064e3b,
      transparent: true,
      opacity: 0.28,
      side: THREE.DoubleSide
    })
  );
  innerPad.rotation.x = -Math.PI / 2;
  innerPad.position.y = 0.015;
  group.add(innerPad);

  // Корпус свинцового контейнера САР (открытый сверху короб из 4 стенок + дно)
  const basePlate = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.08, 0.76), leadMat);
  basePlate.position.y = 0.04;
  basePlate.castShadow = true;
  basePlate.receiveShadow = true;
  group.add(basePlate);

  const wallFront = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.56, 0.08), leadMat);
  wallFront.position.set(0, 0.36, 0.34);
  const wallBack = wallFront.clone();
  wallBack.position.z = -0.34;
  const wallLeft = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.56, 0.60), leadMat);
  wallLeft.position.set(-0.42, 0.36, 0);
  const wallRight = wallLeft.clone();
  wallRight.position.x = 0.42;
  const cavityFloor = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.04, 0.60), innerMat);
  cavityFloor.position.set(0, 0.10, 0);
  group.add(wallFront, wallBack, wallLeft, wallRight, cavityFloor);

  // Жёлтая отбортовка приёмной горловины
  const rim = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.04, 0.78), yellowHazardMat);
  rim.position.set(0, 0.64, 0);
  // Вырезаем визуально за счёт боковых балок, а точнее делаем 4 планки обода:
  rim.visible = false;
  const rimFront = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.04, 0.09), yellowHazardMat);
  rimFront.position.set(0, 0.65, 0.345);
  const rimBack = rimFront.clone();
  rimBack.position.z = -0.345;
  group.add(rimFront, rimBack);

  // Откидная свинцовая крышка на петлях (сзади по Z)
  const lidPivot = new THREE.Group();
  lidPivot.position.set(0, 0.67, -0.36);
  const lidSlab = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.07, 0.74), leadMat);
  lidSlab.position.set(0, 0.035, 0.36);
  lidSlab.castShadow = true;
  const lidHandle = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.04, 0.04), yellowHazardMat);
  lidHandle.position.set(0, 0.09, 0.65);
  lidPivot.add(lidSlab, lidHandle);
  group.add(lidPivot);

  // Табличка с маркировкой САР и статусный маячок
  const label = new THREE.Mesh(
    new THREE.PlaneGeometry(0.76, 0.26),
    new THREE.MeshBasicMaterial({
      map: createEquipmentLabelTexture(titleRu, subtitleRu, '#052e16', '#34d399')
    })
  );
  label.position.set(0, 0.38, 0.39);
  group.add(label);

  const statusLed = new THREE.Mesh(
    new THREE.SphereGeometry(0.055, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xf59e0b })
  );
  statusLed.position.set(0.36, 0.70, 0.32);
  group.add(statusLed);

  group.userData = {
    ...group.userData,
    isSarDropZone: true,
    lidPivot,
    statusLed,
    floorPad,
    depositCount: 0
  };

  return group;
}

export class EvacuationManager {
  private interactiveItems: InteractiveObjectInstance[] = [];
  private sources: RadiationSourceInstance[] = [];
  private extractedIds = new Set<string>();
  private bareHandViolationIds = new Set<string>();
  private completedOperationIds = new Set<string>();
  private metrics: MchsMissionMetrics = this.createEmptyMetrics();

  private carriedItem: InteractiveObjectInstance | null = null;
  private carriedSource: RadiationSourceInstance | null = null;
  private carriedWithTongs = false;
  private carriedBareHandViolation = false;
  private carriedBaseLocalPos = new THREE.Vector3();

  private readonly tempZonePos = new THREE.Vector3();
  private readonly tempCarriedPos = new THREE.Vector3();

  private createEmptyMetrics(): MchsMissionMetrics {
    return {
      operationsCompleted: 0,
      extractedCount: 0,
      totalExtractable: 0,
      tongsCompliantExtractions: 0,
      bareHandViolations: 0,
      spillsDecontaminated: 0,
      firesExtinguished: 0,
      valvesClosed: 0,
      breakersSwitched: 0,
      bareHandViolationDetailsRu: []
    };
  }

  public bindScenario(
    interactiveItems: InteractiveObjectInstance[],
    sources: RadiationSourceInstance[]
  ): void {
    this.interactiveItems = interactiveItems;
    this.sources = sources;
    this.extractedIds.clear();
    this.bareHandViolationIds.clear();
    this.completedOperationIds.clear();
    this.carriedItem = null;
    this.carriedSource = null;
    this.carriedWithTongs = false;
    this.carriedBareHandViolation = false;

    interactiveItems.forEach(item => {
      if (item.type === 'drop_zone' && item.mesh.userData) {
        item.mesh.userData.depositCount = 0;
        const lid = item.mesh.userData.lidPivot as THREE.Group | undefined;
        if (lid) lid.rotation.x = 0;
        const led = item.mesh.userData.statusLed as THREE.Mesh | undefined;
        if (led && led.material instanceof THREE.MeshBasicMaterial) {
          led.material.color.setHex(0xf59e0b);
        }
      }
    });

    const totalExtractable = interactiveItems.filter(
      item =>
        item.type === 'extractable' ||
        item.type === 'casualty' ||
        item.type === 'control_unit'
    ).length;

    this.metrics = {
      ...this.createEmptyMetrics(),
      totalExtractable
    };
  }

  public reset(): void {
    this.bindScenario(this.interactiveItems, this.sources);
  }

  public getMetrics(): MchsMissionMetrics {
    return {
      ...this.metrics,
      bareHandViolationDetailsRu: [...this.metrics.bareHandViolationDetailsRu]
    };
  }

  public recordOperation(
    opId: string,
    kind: 'spill' | 'fire' | 'valve' | 'breaker' | 'generator' | 'other'
  ): void {
    if (this.completedOperationIds.has(opId)) return;
    this.completedOperationIds.add(opId);
    this.metrics.operationsCompleted += 1;
    if (kind === 'spill') this.metrics.spillsDecontaminated += 1;
    if (kind === 'fire') this.metrics.firesExtinguished += 1;
    if (kind === 'valve') this.metrics.valvesClosed += 1;
    if (kind === 'breaker') this.metrics.breakersSwitched += 1;
  }

  public isExtractableType(item: InteractiveObjectInstance): boolean {
    return (
      item.type === 'extractable' ||
      item.type === 'casualty' ||
      item.type === 'control_unit' ||
      item.type === 'source' ||
      item.type === 'sample'
    );
  }

  public isItemExtracted(itemId: string): boolean {
    return this.extractedIds.has(itemId);
  }

  public getCarriedInfo(playerWorldPos?: THREE.Vector3): CarriedHazardInfo | null {
    if (!this.carriedItem) return null;
    const refPos = playerWorldPos ?? this.tempCarriedPos;
    if (!playerWorldPos) {
      this.carriedItem.mesh.getWorldPosition(this.tempCarriedPos);
    }
    const nearest = this.findNearestDropZone(refPos);
    return {
      item: this.carriedItem,
      linkedSource: this.carriedSource,
      usedTongs: this.carriedWithTongs,
      bareHandViolation: this.carriedBareHandViolation,
      nearestDropZoneDistanceM: nearest ? nearest.distance : null
    };
  }

  public startCarry(
    item: InteractiveObjectInstance,
    activeToolId: MchsToolId
  ): { bareHandViolation: boolean; violationMessageRu: string | null } {
    this.carriedItem = item;
    this.carriedSource =
      this.sources.find(s => s.id === item.linkedSourceId || s.mesh === item.mesh) || null;
    this.carriedWithTongs = activeToolId === 'tongs';

    // Сохраняем базовый локальный офсет хвата после grabObject для покачивания при ходьбе
    this.carriedBaseLocalPos.copy(item.mesh.position);

    const requiresTongs = Boolean(item.requiresTongs);
    const violation = requiresTongs && !this.carriedWithTongs;
    this.carriedBareHandViolation = violation;

    if (violation && !this.bareHandViolationIds.has(item.id)) {
      this.bareHandViolationIds.add(item.id);
      this.metrics.bareHandViolations += 1;
      const msg = `НАРУШЕНИЕ ALARA: захват «${item.nameRu}» без дистанционных щипцов [3]! Критическая дозовая нагрузка на кисти и корпус.`;
      this.metrics.bareHandViolationDetailsRu.push(msg);
      return { bareHandViolation: true, violationMessageRu: msg };
    }

    if (requiresTongs && this.carriedWithTongs) {
      this.metrics.tongsCompliantExtractions += 1;
    }

    return { bareHandViolation: false, violationMessageRu: null };
  }

  public clearCarry(): void {
    this.carriedItem = null;
    this.carriedSource = null;
    this.carriedWithTongs = false;
    this.carriedBareHandViolation = false;
  }

  public findNearestDropZone(
    worldPos: THREE.Vector3
  ): { zone: InteractiveObjectInstance; distance: number } | null {
    let bestZone: InteractiveObjectInstance | null = null;
    let bestDist = Infinity;

    for (let i = 0; i < this.interactiveItems.length; i++) {
      const item = this.interactiveItems[i];
      if (item.type !== 'drop_zone' && item.type !== 'container') continue;
      item.mesh.updateWorldMatrix(true, false);
      item.mesh.getWorldPosition(this.tempZonePos);
      const d = worldPos.distanceTo(this.tempZonePos);
      if (d < bestDist) {
        bestDist = d;
        bestZone = item;
      }
    }

    return bestZone ? { zone: bestZone, distance: bestDist } : null;
  }

  public tryDepositObject(
    droppedObject: THREE.Object3D,
    itemMeta: InteractiveObjectInstance | null
  ): {
    deposited: boolean;
    dropZone: InteractiveObjectInstance | null;
    shieldedPercent: number;
  } {
    droppedObject.updateWorldMatrix(true, false);
    droppedObject.getWorldPosition(this.tempCarriedPos);

    const nearest = this.findNearestDropZone(this.tempCarriedPos);
    if (!nearest || nearest.distance > 2.2) {
      this.clearCarry();
      return { deposited: false, dropZone: null, shieldedPercent: 0 };
    }

    const zone = nearest.zone;
    zone.mesh.getWorldPosition(this.tempZonePos);

    // Аккуратно укладываем объект внутрь/на площадку контейнера САР
    const depositCount = Number(zone.mesh.userData?.depositCount ?? 0);
    const offsetX = (depositCount % 2 === 0 ? -1 : 1) * (depositCount > 0 ? 0.18 : 0);
    const isCasualty = itemMeta?.type === 'casualty';

    droppedObject.position.set(
      this.tempZonePos.x + (isCasualty ? 0.85 : offsetX),
      this.tempZonePos.y + (isCasualty ? 0.02 : 0.24),
      this.tempZonePos.z + (isCasualty ? 0.45 : 0)
    );
    droppedObject.rotation.set(0, 0, 0);
    droppedObject.updateWorldMatrix(true, true);

    if (zone.mesh.userData) {
      zone.mesh.userData.depositCount = depositCount + 1;
      const led = zone.mesh.userData.statusLed as THREE.Mesh | undefined;
      if (led && led.material instanceof THREE.MeshBasicMaterial) {
        led.material.color.setHex(0x22c55e);
      }
    }

    // Экранирование на 95% после помещения в свинцовый контейнер САР
    const linkedSource =
      this.carriedSource ||
      this.sources.find(s => s.id === itemMeta?.linkedSourceId || s.mesh === droppedObject) ||
      null;

    if (linkedSource) {
      linkedSource.position.copy(droppedObject.position);
      if (!linkedSource.enclosedInShield) {
        linkedSource.activityMBq = Math.max(0.5, linkedSource.activityMBq * 0.05);
      }
      linkedSource.enclosedInShield = {
        material: zone.shieldMaterial || 'lead',
        thicknessCm: zone.shieldThicknessCm || 10.0
      };
    }

    if (itemMeta && !this.extractedIds.has(itemMeta.id)) {
      this.extractedIds.add(itemMeta.id);
      if (
        itemMeta.type === 'extractable' ||
        itemMeta.type === 'casualty' ||
        itemMeta.type === 'control_unit' ||
        itemMeta.type === 'source'
      ) {
        this.metrics.extractedCount += 1;
      }
      this.recordOperation(`extract_${itemMeta.id}`, 'other');
    }

    this.clearCarry();
    return { deposited: true, dropZone: zone, shieldedPercent: 95 };
  }

  /**
   * Вызывается каждый кадр:
   * - Синхронизирует координаты RadiationSourceInstance с переносимым объектом для живого расчёта 1/r².
   * - Добавляет лёгкую инерцию покачивания при ходьбе.
   * - Анимирует откидные крышки свинцовых контейнеров САР при приближении носителя.
   */
  public update(
    dt: number,
    elapsedSec: number,
    isMoving: boolean,
    carrierWorldPos: THREE.Vector3
  ): void {
    // 1. Живая позиция переносимого источника + инерция ходьбы (аддитивно, совместимо с коллизиями)
    if (this.carriedItem) {
      const swayAmp = isMoving ? 0.009 : 0.0018;
      const swayY = Math.sin(elapsedSec * 7.2) * swayAmp;
      const swayX = Math.cos(elapsedSec * 3.6) * (swayAmp * 0.65);
      const swayRotZ = Math.sin(elapsedSec * 3.6) * (isMoving ? 0.032 : 0.006);
      this.carriedItem.mesh.position.x += swayX;
      this.carriedItem.mesh.position.y += swayY;
      this.carriedItem.mesh.rotation.z += swayRotZ;
      this.carriedItem.mesh.updateWorldMatrix(true, false);

      if (this.carriedSource) {
        this.carriedItem.mesh.getWorldPosition(this.tempCarriedPos);
        this.carriedSource.position.copy(this.tempCarriedPos);
      }
    }

    // 2. Анимация крышки контейнера САР при приближении оператора с грузом
    for (let i = 0; i < this.interactiveItems.length; i++) {
      const item = this.interactiveItems[i];
      if (item.type !== 'drop_zone') continue;
      const lidPivot = item.mesh.userData?.lidPivot as THREE.Group | undefined;
      if (!lidPivot) continue;

      item.mesh.getWorldPosition(this.tempZonePos);
      const dist = carrierWorldPos.distanceTo(this.tempZonePos);
      const shouldOpen = Boolean(this.carriedItem) && dist < 2.6;
      const targetAngle = shouldOpen ? -Math.PI * 0.56 : 0;
      lidPivot.rotation.x += (targetAngle - lidPivot.rotation.x) * Math.min(1, dt * 7.5);
    }
  }
}
