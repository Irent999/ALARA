/**
 * ALARA-Planner Pro VR — Система взаимодействия с удержанием (InteractionHoldSystem.ts)
 *
 * Обеспечивает:
 * - Удержание кнопки (ЛКМ / E на ПК, Trigger на VR-контроллере) 2–5 сек для технологических операций:
 *   дезактивация просыпи лопатой, тушение пожара ОУ-5, поворот задвижки, обесточивание, пуск МДНУ, герметизация.
 * - Плавный откат прогресса при преждевременном отпускании (без срабатывания действия).
 * - Двойную визуальную обратную связь:
 *   1) 3D-диегетический радиальный индикатор прогресса с текстом и % над объектом в сцене/VR.
 *   2) Снапшот прогресса для центрального радиального HUD-прицела на Desktop.
 * - Непрерывную тактильную пульсацию VR-контроллеров в процессе удержания.
 */

import * as THREE from 'three';

export type HoldActionKind =
  | 'decontaminate'
  | 'extinguish'
  | 'valve'
  | 'breaker'
  | 'generator'
  | 'seal'
  | 'interact';

export interface HoldActionSpec {
  targetId: string;
  targetMesh: THREE.Object3D;
  labelRu: string;
  kind: HoldActionKind;
  durationSec: number;
  requiredToolId?: string;
  preferredToolId?: string;
  onProgress?: (progress01: number) => void;
  onComplete: () => void;
}

export interface HoldProgressSnapshot {
  isHolding: boolean;
  targetId: string | null;
  labelRu: string;
  kind: HoldActionKind | null;
  progress: number; // 0..1
  remainingSec: number;
}

export class InteractionHoldSystem {
  private readonly scene: THREE.Scene;
  private activeSpec: HoldActionSpec | null = null;
  private progress = 0;
  private isHolding = false;
  private lastHapticPulseMs = 0;

  // 3D-диегетическая плашка прогресса над точкой взаимодействия
  public readonly indicatorGroup: THREE.Group;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly planeMesh: THREE.Mesh;
  private lastRenderedPct = -1;
  private lastRenderedLabel = '';

  // Переиспользуемые векторы без аллокаций в кадре
  private readonly tempBox = new THREE.Box3();
  private readonly tempTargetPos = new THREE.Vector3();
  private readonly tempCamPos = new THREE.Vector3();

  private onHapticPulse?: (intensity: number, durationMs: number) => void;
  private onSnapshot?: (snapshot: HoldProgressSnapshot) => void;

  constructor(
    scene: THREE.Scene,
    callbacks?: {
      onHapticPulse?: (intensity: number, durationMs: number) => void;
      onSnapshot?: (snapshot: HoldProgressSnapshot) => void;
    }
  ) {
    this.scene = scene;
    this.onHapticPulse = callbacks?.onHapticPulse;
    this.onSnapshot = callbacks?.onSnapshot;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 512;
    this.canvas.height = 224;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.planeMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.40),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        side: THREE.DoubleSide
      })
    );
    this.planeMesh.renderOrder = 25;
    this.planeMesh.raycast = () => {};

    this.indicatorGroup = new THREE.Group();
    this.indicatorGroup.name = 'hold_interaction_3d_indicator';
    this.indicatorGroup.visible = false;
    this.indicatorGroup.add(this.planeMesh);
    this.scene.add(this.indicatorGroup);
  }

  public getIsHolding(): boolean {
    return this.isHolding;
  }

  public getActiveKind(): HoldActionKind | null {
    return this.activeSpec?.kind ?? null;
  }

  public getTargetWorldPos(out: THREE.Vector3): boolean {
    if (!this.activeSpec) return false;
    this.activeSpec.targetMesh.getWorldPosition(out);
    return true;
  }

  public getSnapshot(): HoldProgressSnapshot {
    const dur = this.activeSpec?.durationSec ?? 2.5;
    return {
      isHolding: this.isHolding && this.progress > 0.001,
      targetId: this.activeSpec?.targetId ?? null,
      labelRu: this.activeSpec?.labelRu ?? '',
      kind: this.activeSpec?.kind ?? null,
      progress: this.progress,
      remainingSec: Math.max(0, dur * (1 - this.progress))
    };
  }

  public stepHold(spec: HoldActionSpec, dt: number): boolean {
    if (!this.activeSpec || this.activeSpec.targetId !== spec.targetId) {
      this.activeSpec = spec;
      this.progress = 0;
    } else {
      this.activeSpec = spec;
    }

    this.isHolding = true;
    const duration = Math.max(0.6, spec.durationSec);
    this.progress = Math.min(1.0, this.progress + dt / duration);
    spec.onProgress?.(this.progress);

    // Непрерывный тактильный отклик на VR-контроллеры в процессе удержания
    const now = performance.now();
    if (now - this.lastHapticPulseMs >= 115) {
      this.lastHapticPulseMs = now;
      this.onHapticPulse?.(0.18 + this.progress * 0.34, 42);
    }

    this.update3DIndicatorPlacement();
    this.redraw3DCanvasIfNeeded();
    this.emitSnapshot();

    if (this.progress >= 1.0) {
      const completedSpec = this.activeSpec;
      this.onHapticPulse?.(0.75, 95);
      this.reset();
      completedSpec.onComplete();
      return true;
    }

    return false;
  }

  public decay(dt: number): void {
    if (!this.activeSpec && this.progress <= 0) {
      this.isHolding = false;
      this.indicatorGroup.visible = false;
      return;
    }

    this.isHolding = false;
    this.progress = Math.max(0, this.progress - dt * 2.2);

    if (this.progress <= 0.001) {
      this.reset();
    } else {
      this.activeSpec?.onProgress?.(this.progress);
      this.update3DIndicatorPlacement();
      this.redraw3DCanvasIfNeeded();
      this.emitSnapshot();
    }
  }

  public reset(): void {
    const hadState = this.isHolding || this.progress > 0 || this.activeSpec !== null;
    this.activeSpec = null;
    this.progress = 0;
    this.isHolding = false;
    this.indicatorGroup.visible = false;
    this.lastRenderedPct = -1;
    this.lastRenderedLabel = '';
    if (hadState) {
      this.emitSnapshot();
    }
  }

  public updateBillboard(camera: THREE.Camera | null): void {
    if (!this.indicatorGroup.visible || !camera) return;
    camera.getWorldPosition(this.tempCamPos);
    this.indicatorGroup.lookAt(this.tempCamPos);
  }

  private update3DIndicatorPlacement(): void {
    if (!this.activeSpec) {
      this.indicatorGroup.visible = false;
      return;
    }
    this.activeSpec.targetMesh.updateWorldMatrix(true, false);
    this.tempBox.setFromObject(this.activeSpec.targetMesh);
    if (!this.tempBox.isEmpty()) {
      this.tempBox.getCenter(this.tempTargetPos);
      this.tempTargetPos.y = Math.min(2.6, Math.max(0.75, this.tempBox.max.y + 0.36));
    } else {
      this.activeSpec.targetMesh.getWorldPosition(this.tempTargetPos);
      this.tempTargetPos.y += 0.55;
    }
    this.indicatorGroup.position.copy(this.tempTargetPos);
    this.indicatorGroup.visible = true;
  }

  private redraw3DCanvasIfNeeded(): void {
    if (!this.activeSpec) return;
    const pct = Math.round(this.progress * 100);
    if (Math.abs(pct - this.lastRenderedPct) < 1 && this.activeSpec.labelRu === this.lastRenderedLabel) {
      return;
    }
    this.lastRenderedPct = pct;
    this.lastRenderedLabel = this.activeSpec.labelRu;

    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Полупрозрачная строгая подложка
    ctx.fillStyle = 'rgba(8, 13, 24, 0.90)';
    ctx.beginPath();
    ctx.roundRect(10, 10, w - 20, h - 20, 22);
    ctx.fill();

    ctx.strokeStyle = this.progress > 0.75 ? '#22c55e' : '#38bdf8';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Кольцевой индикатор слева
    const cx = 92;
    const cy = h / 2;
    const r = 54;

    ctx.strokeStyle = 'rgba(148, 163, 184, 0.25)';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = this.progress > 0.75 ? '#4ade80' : '#facc15';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.progress);
    ctx.stroke();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${pct}%`, cx, cy);

    // Текст действия справа
    ctx.textAlign = 'left';
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('УДЕРЖИВАЙТЕ ДЕЙСТВИЕ', 172, 66);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 26px sans-serif';
    const cleanLabel =
      this.activeSpec.labelRu.length > 26
        ? this.activeSpec.labelRu.slice(0, 24) + '...'
        : this.activeSpec.labelRu;
    ctx.fillText(cleanLabel, 172, 114);

    // Полоса времени
    ctx.fillStyle = 'rgba(30, 41, 59, 0.95)';
    ctx.fillRect(172, 152, 304, 16);
    ctx.fillStyle = this.progress > 0.75 ? '#22c55e' : '#38bdf8';
    ctx.fillRect(172, 152, Math.round(304 * this.progress), 16);

    this.texture.needsUpdate = true;
  }

  private emitSnapshot(): void {
    this.onSnapshot?.(this.getSnapshot());
  }

  public dispose(): void {
    this.texture.dispose();
    (this.planeMesh.material as THREE.Material).dispose();
    this.planeMesh.geometry.dispose();
    this.scene.remove(this.indicatorGroup);
  }
}
