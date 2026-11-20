/**
 * VR-планшет лабораторных заданий (canvas → плоскость). Добавляется в vrUiSystem.rootGroup
 * (панель следует за камерой, как остальной VR UI). Поддерживает УДЕРЖАНИЕ кнопки:
 * press() при selectstart, release() при selectend или уходе луча с кнопки.
 */
import * as THREE from 'three';
import type { QuestCommand, QuestSnapshot, TaskControl } from '../quest';
import type { VRInteractionHit } from './vrUiSystem';

interface Btn { id: string; x: number; y: number; w: number; h: number; hold?: boolean; enabled: boolean; cmd: () => void; label: string; active?: boolean }

const W = 1024, H = 780;
const LIMIT_PRESETS = [0.01, 0.05, 0.1, 0.5];

export class VRQuestPanel {
  readonly group = new THREE.Group();
  private mesh: THREE.Mesh;
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;
  private texture: THREE.CanvasTexture;
  private buttons: Btn[] = [];
  private hovered: string | undefined;
  private held: Btn | null = null;
  private snap: QuestSnapshot | null = null;
  private lastDraw = 0;

  constructor(private readonly dispatch: (cmd: QuestCommand) => void) {
    this.canvas.width = W; this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.minFilter = THREE.LinearFilter;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true, depthTest: false });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.70), mat);
    this.mesh.renderOrder = 998;
    this.group.add(this.mesh);
    this.group.position.set(-0.95, 0.0, -1.25);
    this.group.rotation.y = 0.5;
    this.group.name = 'VRQuestPanel';
  }

  setSnapshot(s: QuestSnapshot): void {
    this.snap = s;
    const now = performance.now();
    if (now - this.lastDraw > 120) this.draw();
  }

  /** Наведение: возвращает попадание в панель (для лазера) и снимает удержание при уходе с кнопки. */
  testRaycast(raycaster: THREE.Raycaster): VRInteractionHit | null {
    if (!this.group.visible || !this.snap) return null;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) {
      if (this.held) this.release();
      return null;
    }
    const b = this.buttonAt(hit.uv);
    if (this.held && b?.id !== this.held.id) this.release();
    if (this.hovered !== b?.id) { this.hovered = b?.id; this.draw(); }
    return { panelId: 'quest', buttonId: b?.id, point: hit.point } as unknown as VRInteractionHit;
  }

  /** selectstart: true, если курок «съела» панель. */
  press(raycaster: THREE.Raycaster): boolean {
    if (!this.group.visible || !this.snap) return false;
    const hit = raycaster.intersectObject(this.mesh, false)[0];
    if (!hit || !hit.uv) return false;
    const b = this.buttonAt(hit.uv);
    if (b && b.enabled) {
      if (b.hold) this.held = b;
      b.cmd();
    }
    this.draw();
    return true;
  }

  /** selectend: отпускание удерживаемой кнопки. */
  release(): void {
    if (this.held) {
      this.held = null;
      this.dispatch({ type: 'hold_fix_background', down: false });
      this.draw();
    }
  }

  private buttonAt(uv: THREE.Vector2): Btn | undefined {
    const px = uv.x * W, py = (1 - uv.y) * H;
    return this.buttons.find(b => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h);
  }

  private rr(x: number, y: number, w: number, h: number, r: number): void {
    const c = this.ctx; c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
  }

  private wrap(text: string, x: number, y: number, maxW: number, lh: number, maxLines = 3): void {
    const c = this.ctx; const words = text.split(' '); let line = ''; let n = 0;
    for (const w of words) {
      const t = line ? line + ' ' + w : w;
      if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y + n * lh); n++; line = w; if (n >= maxLines) return; } else line = t;
    }
    if (line && n < maxLines) c.fillText(line, x, y + n * lh);
  }

  private draw(): void {
    this.lastDraw = performance.now();
    const c = this.ctx; const s = this.snap;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(8,16,26,0.96)'; this.rr(8, 8, W - 16, H - 16, 26); c.fill();
    c.strokeStyle = '#06b6d4'; c.lineWidth = 4; this.rr(8, 8, W - 16, H - 16, 26); c.stroke();
    this.buttons = [];
    if (!s) { this.texture.needsUpdate = true; return; }

    c.fillStyle = '#22d3ee'; c.font = 'bold 28px sans-serif';
    c.fillText('📟 ЛАБОРАТОРНЫЕ ЗАДАНИЯ', 32, 52);
    c.fillStyle = '#94a3b8'; c.font = 'bold 22px monospace';
    c.fillText(`${s.completedCount}/${s.total}`, W - 120, 52);

    // список заданий
    c.font = '20px sans-serif';
    s.tasks.forEach((t, i) => {
      c.fillStyle = t.status === 'completed' ? '#6ee7b7' : t.status === 'active' ? '#ffffff' : '#64748b';
      c.fillText(`${t.status === 'completed' ? '✓' : t.status === 'active' ? '▶' : '🔒'} ${i + 1}. ${t.titleRu}`, 32, 92 + i * 28);
    });

    const a = s.activeIndex >= 0 ? s.tasks[s.activeIndex] : null;
    let y = 252;
    c.strokeStyle = '#334155'; c.lineWidth = 2; c.beginPath(); c.moveTo(28, y - 22); c.lineTo(W - 28, y - 22); c.stroke();
    if (!a) {
      c.fillStyle = '#6ee7b7'; c.font = 'bold 30px sans-serif'; c.fillText('Все задания выполнены 🎓', 32, y + 40);
    } else {
      c.fillStyle = '#cbd5e1'; c.font = '19px sans-serif';
      this.wrap(a.goalRu, 32, y, W - 64, 24, 2);
      y += 56;
      c.font = '19px sans-serif';
      a.steps.forEach(st => {
        c.fillStyle = st.state === 'done' ? '#6ee7b7' : st.state === 'current' ? '#67e8f9' : '#64748b';
        c.fillText(`${st.state === 'done' ? '✓' : st.state === 'current' ? '▶' : '○'} ${st.titleRu}`, 32, y); y += 26;
      });
      y += 4;
      c.fillStyle = '#1e293b'; this.rr(32, y, W - 64, 14, 7); c.fill();
      c.fillStyle = '#22d3ee'; this.rr(32, y, Math.max(8, (W - 64) * a.progress), 14, 7); c.fill();
      y += 40;
      c.fillStyle = '#fde68a'; c.font = 'bold 20px sans-serif';
      this.wrap(a.instructionRu, 32, y, W - 64, 26, 2);
      this.drawControls(a.controls, y + 56);
    }

    if (s.feedback) {
      const bad = s.feedback.kind === 'warn' || s.feedback.kind === 'error';
      c.fillStyle = bad ? 'rgba(127,29,29,0.7)' : s.feedback.kind === 'success' ? 'rgba(6,78,59,0.7)' : 'rgba(30,41,59,0.8)';
      this.rr(28, H - 78, W - 56, 56, 12); c.fill();
      c.fillStyle = bad ? '#fecaca' : '#e2e8f0'; c.font = '18px sans-serif';
      this.wrap(s.feedback.text, 44, H - 54, W - 90, 22, 2);
    }
    this.texture.needsUpdate = true;
  }

  private drawControls(controls: TaskControl[], topY: number): void {
    const c = this.ctx;
    let x = 32; const h = 64; let y = topY;
    const addBtn = (b: Btn) => {
      this.buttons.push(b);
      const hov = this.hovered === b.id;
      c.fillStyle = !b.enabled ? '#1e293b' : b.active ? '#b45309' : hov ? '#0e7490' : '#155e75';
      this.rr(b.x, b.y, b.w, b.h, 14); c.fill();
      c.strokeStyle = !b.enabled ? '#334155' : hov ? '#facc15' : '#22d3ee'; c.lineWidth = hov ? 4 : 2;
      this.rr(b.x, b.y, b.w, b.h, 14); c.stroke();
      c.fillStyle = b.enabled ? '#ffffff' : '#64748b'; c.font = 'bold 21px sans-serif';
      this.wrap(b.label, b.x + 16, b.y + 28, b.w - 32, 24, 2);
    };
    for (const k of controls) {
      if (k.kind === 'hold') {
        addBtn({ id: k.id, x, y, w: W - 64, h, hold: true, enabled: k.enabled, active: k.holding, label: (k.holding ? '⏳ ' : '⏺ ') + k.labelRu + ' — УДЕРЖИВАЙТЕ КУРОК', cmd: () => this.dispatch({ type: 'hold_fix_background', down: true }) });
        y += h + 12;
      } else if (k.kind === 'press') {
        const type = k.id === 'save_distance_point' ? 'save_distance_point' : k.id === 'measure_under_shield' ? 'measure_under_shield' : 'start_work_timer';
        addBtn({ id: k.id, x, y, w: W - 64, h, enabled: k.enabled, label: k.labelRu, cmd: () => this.dispatch({ type } as QuestCommand) });
        y += h + 12;
      } else {
        // ввод предела — кнопки-пресеты (в VR нет клавиатуры)
        c.fillStyle = '#cbd5e1'; c.font = '18px sans-serif';
        c.fillText(`${k.labelRu} (${k.unit})${k.value !== null ? ' — задан: ' + k.value : ''}`, x, y + 18);
        y += 28;
        const bw = (W - 64 - 3 * 12) / 4;
        LIMIT_PRESETS.forEach((v, i) => addBtn({ id: `limit_${v}`, x: x + i * (bw + 12), y, w: bw, h: 52, enabled: k.enabled, active: k.value === v, label: `${v} мЗв`, cmd: () => this.dispatch({ type: 'set_alara_limit', limitMSv: v }) }));
        y += 52 + 12;
      }
    }
  }

  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}
