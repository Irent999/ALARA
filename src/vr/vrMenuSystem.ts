/**
 * VRMenuSystem — компактное VR-меню поверх существующего VRUISystem.
 *
 *  • Панель-«пояс» (toolbar) в нижней части поля зрения: [HUD вкл/выкл] [ЗАДАНИЯ] [СЦЕНАРИИ]
 *  • Окно «ВЫБОР СЦЕНАРИЯ» (постраничный список)
 *  • Окно «ЗАДАНИЯ» (этапы текущего сценария с отметками выполнено / текущий / впереди)
 *  • Окно «СЦЕНАРИЙ ВЫПОЛНЕН» (время, доза, кнопки: повторить / следующий / закрыть)
 *  • Короткие уведомления над панелью, когда основной HUD скрыт
 *
 * Нажатие: наведите луч контроллера на кнопку и нажмите курок (select).
 * Все панели — Canvas-текстуры на PlaneGeometry, без внешних зависимостей.
 */

import * as THREE from 'three';

export interface VRMenuScenario {
  id: number;
  titleRu: string;
  facilityRu?: string;
}

export interface VRMenuStage {
  titleRu: string;
  taskRu: string;
  hintRu?: string;
}

export interface VRMenuScenarioDetail extends VRMenuScenario {
  stages: ReadonlyArray<VRMenuStage>;
}

export interface VRMenuSuccessStats {
  timeSec: number;
  doseMsv: number;
  limitMsv: number;
}

type ModalMode = 'closed' | 'scenarios' | 'tasks' | 'success';
type ButtonStyle = 'neutral' | 'primary' | 'success' | 'warning';

interface HitRect {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

// ---------------------------------------------------------------- canvas helpers
function rrPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function fillRR(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number, color: string): void {
  rrPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

function strokeRR(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: string,
  lineWidth: number
): void {
  rrPath(ctx, x, y, w, h, r);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.stroke();
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = words[i];
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines;
}

function drawCheck(ctx: CanvasRenderingContext2D, cx: number, cy: number, size: number, color: string, lw: number): void {
  ctx.beginPath();
  ctx.moveTo(cx - size * 0.5, cy + size * 0.02);
  ctx.lineTo(cx - size * 0.12, cy + size * 0.4);
  ctx.lineTo(cx + size * 0.55, cy - size * 0.38);
  ctx.strokeStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function formatTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}`;
}

// ---------------------------------------------------------------- panel
class MenuPanel {
  public readonly canvas: HTMLCanvasElement;
  public readonly ctx: CanvasRenderingContext2D;
  public readonly texture: THREE.CanvasTexture;
  public readonly mesh: THREE.Mesh;
  public buttons: HitRect[] = [];
  public hovered: string | null = null;
  public dirty = true;

  constructor(
    public readonly pxW: number,
    public readonly pxH: number,
    widthM: number,
    heightM: number,
    renderOrder: number
  ) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW;
    this.canvas.height = pxH;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    this.texture.generateMipmaps = false;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      fog: false
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM), material);
    this.mesh.renderOrder = renderOrder;
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
  }

  public dispose(): void {
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

interface PickResult {
  panel: MenuPanel;
  buttonId: string | null;
}

// ---------------------------------------------------------------- system
export class VRMenuSystem {
  public readonly rootGroup = new THREE.Group();

  /** true — основной VR HUD (VRUISystem) скрыт пользователем */
  public hudHidden = false;

  public onToggleHud: ((hidden: boolean) => void) | null = null;
  public onSelectScenario: ((id: number) => void) | null = null;
  public onRestartScenario: (() => void) | null = null;

  private readonly scenarios: ReadonlyArray<VRMenuScenario>;
  private current: VRMenuScenarioDetail | null = null;
  private step = 0;
  private completed = false;
  private stats: VRMenuSuccessStats = { timeSec: 0, doseMsv: 0, limitMsv: 0 };

  private mode: ModalMode = 'closed';
  private page = 0;
  private readonly perPage = 5;
  private pendingPlace = false;

  private readonly bar = new MenuPanel(768, 150, 0.4, 0.078, 1000);
  private readonly modal = new MenuPanel(1024, 768, 1.0, 0.75, 1001);
  private readonly notice = new MenuPanel(768, 100, 0.4, 0.052, 1000);

  private noticeText = '';
  private noticeType = 'info';
  private noticeTimer = 0;

  private hoverState: Array<{ panel: MenuPanel; id: string | null } | null> = [null, null];

  // раскладка / «ленивое» следование панели за игроком
  private barPlaced = false;
  private barFollowing = false;
  private readonly barAnchorFwd = new THREE.Vector3(0, 0, -1);
  private readonly lastFwd = new THREE.Vector3(0, 0, -1);
  private readonly tmpCamPos = new THREE.Vector3();
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpTarget = new THREE.Vector3();

  constructor(scenarios: ReadonlyArray<VRMenuScenario>) {
    this.scenarios = scenarios;
    this.rootGroup.name = 'vr_menu_root';
    this.rootGroup.add(this.bar.mesh, this.modal.mesh, this.notice.mesh);
    this.bar.mesh.visible = true;
  }

  // ------------------------------------------------------------ public API
  public setVisible(visible: boolean): void {
    this.rootGroup.visible = visible;
    if (!visible) {
      this.mode = 'closed';
      this.modal.mesh.visible = false;
      this.notice.mesh.visible = false;
      this.hoverState = [null, null];
      this.barPlaced = false; // при следующем входе в VR панель встанет перед игроком
    }
  }

  /** Обновить данные текущего сценария (вызывать при смене сценария / этапа). */
  public setScenarioState(scenario: VRMenuScenarioDetail, step: number, completed: boolean): void {
    this.current = scenario;
    this.step = step;
    this.completed = completed;
    this.bar.dirty = true;
    this.modal.dirty = true;
  }

  public showSuccess(stats: VRMenuSuccessStats): void {
    if (!this.rootGroup.visible) return;
    this.stats = stats;
    this.open('success');
  }

  public pushNotice(type: string, title: string): void {
    this.noticeType = type;
    this.noticeText = title;
    this.noticeTimer = 4.5;
    this.notice.dirty = true;
  }

  /** Принудительно показать HUD (например, при провале сценария). */
  public forceShowHud(): void {
    if (!this.hudHidden) return;
    this.hudHidden = false;
    this.onToggleHud?.(false);
    this.bar.dirty = true;
  }

  public close(): void {
    this.mode = 'closed';
    this.modal.mesh.visible = false;
    this.modal.hovered = null;
    this.bar.dirty = true;
  }

  public dispose(): void {
    this.bar.dispose();
    this.modal.dispose();
    this.notice.dispose();
  }

  // ------------------------------------------------------------ interaction
  public updateHover(raycaster: THREE.Raycaster, controllerIdx: number): { hit: boolean; buttonId: string | null } {
    const res = this.pick(raycaster);
    const idx = controllerIdx === 1 ? 1 : 0;
    this.hoverState[idx] = res ? { panel: res.panel, id: res.buttonId } : null;
    this.syncHover();
    return { hit: res !== null, buttonId: res ? res.buttonId : null };
  }

  /** @returns true, если луч попал в панель меню (событие поглощено) */
  public handleSelect(raycaster: THREE.Raycaster): boolean {
    const res = this.pick(raycaster);
    if (!res) return false;
    if (res.buttonId) this.activate(res.buttonId);
    return true;
  }

  private pick(raycaster: THREE.Raycaster): PickResult | null {
    if (!this.rootGroup.visible) return null;
    const targets: THREE.Object3D[] = [];
    if (this.modal.mesh.visible) targets.push(this.modal.mesh);
    if (this.bar.mesh.visible) targets.push(this.bar.mesh);
    if (targets.length === 0) return null;

    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;

    const hit = hits[0];
    const panel = hit.object === this.modal.mesh ? this.modal : this.bar;
    if (!hit.uv) return { panel, buttonId: null };

    const px = hit.uv.x * panel.pxW;
    const py = (1 - hit.uv.y) * panel.pxH;
    for (let i = 0; i < panel.buttons.length; i++) {
      const b = panel.buttons[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) {
        return { panel, buttonId: b.id };
      }
    }
    return { panel, buttonId: null };
  }

  private syncHover(): void {
    const panels = [this.bar, this.modal];
    for (let p = 0; p < panels.length; p++) {
      const panel = panels[p];
      let id: string | null = null;
      for (let i = 0; i < this.hoverState.length; i++) {
        const hs = this.hoverState[i];
        if (hs && hs.panel === panel && hs.id) {
          id = hs.id;
          break;
        }
      }
      if (panel.hovered !== id) {
        panel.hovered = id;
        panel.dirty = true;
      }
    }
  }

  private open(mode: Exclude<ModalMode, 'closed'>): void {
    this.mode = mode;
    this.page = 0;
    if (mode === 'scenarios' && this.current) {
      const idx = this.scenarios.findIndex(s => s.id === this.current!.id);
      if (idx >= 0) this.page = Math.floor(idx / this.perPage);
    }
    if (this.modal.mesh.visible === false) this.pendingPlace = true;
    this.modal.mesh.visible = true;
    this.modal.dirty = true;
    this.bar.dirty = true;
  }

  private activate(id: string): void {
    if (id === 'hud') {
      this.hudHidden = !this.hudHidden;
      this.onToggleHud?.(this.hudHidden);
      this.bar.dirty = true;
      return;
    }
    if (id === 'tasks') {
      if (this.mode === 'tasks') this.close();
      else this.open('tasks');
      return;
    }
    if (id === 'scenarios') {
      if (this.mode === 'scenarios') this.close();
      else this.open('scenarios');
      return;
    }
    if (id === 'close') {
      this.close();
      return;
    }
    if (id === 'goto-scn') {
      this.open('scenarios');
      return;
    }
    if (id === 'prev') {
      this.page = Math.max(0, this.page - 1);
      this.modal.dirty = true;
      return;
    }
    if (id === 'next') {
      const pages = Math.max(1, Math.ceil(this.scenarios.length / this.perPage));
      this.page = Math.min(pages - 1, this.page + 1);
      this.modal.dirty = true;
      return;
    }
    if (id === 'restart') {
      this.close();
      this.onRestartScenario?.();
      return;
    }
    if (id === 'next-scn') {
      const next = this.getNextScenario();
      this.close();
      if (next) this.onSelectScenario?.(next.id);
      return;
    }
    if (id.startsWith('scn:')) {
      const scnId = Number(id.slice(4));
      this.close();
      if (!Number.isNaN(scnId)) this.onSelectScenario?.(scnId);
    }
  }

  private getNextScenario(): VRMenuScenario | null {
    if (!this.current) return null;
    const idx = this.scenarios.findIndex(s => s.id === this.current!.id);
    return idx >= 0 && idx + 1 < this.scenarios.length ? this.scenarios[idx + 1] : null;
  }

  // ------------------------------------------------------------ per-frame
  public update(dt: number, camera: THREE.Camera): void {
    if (!this.rootGroup.visible) return;

    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.tmpCamPos);
    camera.getWorldDirection(this.tmpDir);
    this.tmpDir.y = 0;
    if (this.tmpDir.lengthSq() > 0.05) {
      this.tmpDir.normalize();
      this.lastFwd.copy(this.tmpDir);
    } else {
      this.tmpDir.copy(this.lastFwd);
    }

    // --- панель-пояс: ленивое следование (не «пляшет» при каждом повороте головы)
    const bar = this.bar.mesh;
    this.tmpTarget.copy(this.tmpCamPos).addScaledVector(this.tmpDir, 0.5);
    this.tmpTarget.y = this.tmpCamPos.y - 0.55;

    if (!this.barPlaced) {
      bar.position.copy(this.tmpTarget);
      this.barAnchorFwd.copy(this.tmpDir);
      this.barPlaced = true;
      this.barFollowing = false;
    } else {
      const dx = bar.position.x - this.tmpTarget.x;
      const dz = bar.position.z - this.tmpTarget.z;
      const dy = bar.position.y - this.tmpTarget.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      const yawCos = this.barAnchorFwd.dot(this.tmpDir);
      if (!this.barFollowing && (dist > 0.4 || yawCos < 0.57 || Math.abs(dy) > 0.3)) {
        this.barFollowing = true;
      }
      if (this.barFollowing) {
        bar.position.lerp(this.tmpTarget, 1 - Math.exp(-5 * dt));
        if (dist < 0.04 && Math.abs(dy) < 0.04) {
          this.barFollowing = false;
          this.barAnchorFwd.copy(this.tmpDir);
        }
      }
    }
    bar.lookAt(this.tmpCamPos);

    // --- уведомление над панелью (только когда HUD скрыт)
    if (this.noticeTimer > 0) this.noticeTimer -= dt;
    const showNotice = this.hudHidden && this.noticeTimer > 0;
    if (showNotice !== this.notice.mesh.visible) this.notice.mesh.visible = showNotice;
    if (showNotice) {
      this.notice.mesh.position.set(bar.position.x, bar.position.y + 0.075, bar.position.z);
      this.notice.mesh.lookAt(this.tmpCamPos);
    }

    // --- модальное окно: ставится перед игроком при открытии и дальше неподвижно
    if (this.pendingPlace) {
      const m = this.modal.mesh;
      m.position.copy(this.tmpCamPos).addScaledVector(this.tmpDir, 1.1);
      m.position.y = this.tmpCamPos.y - 0.05;
      m.lookAt(this.tmpCamPos.x, m.position.y, this.tmpCamPos.z);
      this.pendingPlace = false;
    }

    // --- перерисовка по необходимости
    if (this.bar.dirty) this.drawBar();
    if (this.notice.dirty && showNotice) this.drawNotice();
    if (this.modal.dirty && this.modal.mesh.visible) this.drawModal();

    this.rootGroup.updateMatrixWorld(true);
  }

  // ------------------------------------------------------------ drawing: shared
  private drawButton(
    p: MenuPanel,
    id: string,
    label: string,
    sub: string | null,
    x: number,
    y: number,
    w: number,
    h: number,
    style: ButtonStyle
  ): void {
    const ctx = p.ctx;
    p.buttons.push({ id, x, y, w, h });
    const hovered = p.hovered === id;

    let fill = '#1e293b';
    let border = '#475569';
    if (style === 'primary') {
      fill = '#0c4a6e';
      border = '#38bdf8';
    } else if (style === 'success') {
      fill = '#14532d';
      border = '#22c55e';
    } else if (style === 'warning') {
      fill = '#422006';
      border = '#eab308';
    }
    if (hovered) {
      fill = '#334155';
      border = '#facc15';
    }

    fillRR(ctx, x, y, w, h, 14, fill);
    strokeRR(ctx, x, y, w, h, 14, border, hovered ? 5 : 3);

    const labelPx = h >= 100 ? 32 : h >= 70 ? 28 : 24;
    ctx.textAlign = 'center';
    ctx.fillStyle = hovered ? '#fef9c3' : '#f1f5f9';
    ctx.font = `bold ${labelPx}px sans-serif`;
    if (sub) {
      ctx.fillText(label, x + w / 2, y + h / 2 - 2);
      ctx.fillStyle = hovered ? '#fde68a' : '#94a3b8';
      ctx.font = '21px sans-serif';
      ctx.fillText(sub, x + w / 2, y + h / 2 + 28);
    } else {
      ctx.fillText(label, x + w / 2, y + h / 2 + labelPx * 0.35);
    }
    ctx.textAlign = 'left';
  }

  // ------------------------------------------------------------ drawing: toolbar
  private completedCount(): number {
    const total = this.current ? this.current.stages.length : 0;
    if (this.completed) return Math.min(total, this.step + 1);
    return Math.min(total, this.step);
  }

  private drawBar(): void {
    const p = this.bar;
    const ctx = p.ctx;
    p.buttons = [];
    ctx.clearRect(0, 0, p.pxW, p.pxH);
    fillRR(ctx, 0, 0, p.pxW, p.pxH, 24, 'rgba(9,13,22,0.94)');
    strokeRR(ctx, 2, 2, p.pxW - 4, p.pxH - 4, 24, '#38bdf8', 4);

    const bw = 236;
    const bh = 118;
    const y = 16;
    const x0 = 18;
    const gap = 12;
    const total = this.current ? this.current.stages.length : 0;

    this.drawButton(p, 'hud', 'HUD', this.hudHidden ? 'скрыт' : 'показан', x0, y, bw, bh, this.hudHidden ? 'warning' : 'neutral');
    this.drawButton(
      p,
      'tasks',
      'ЗАДАНИЯ',
      total > 0 ? `${this.completedCount()} из ${total}` : null,
      x0 + bw + gap,
      y,
      bw,
      bh,
      this.mode === 'tasks' ? 'primary' : this.completed ? 'success' : 'neutral'
    );
    this.drawButton(
      p,
      'scenarios',
      'СЦЕНАРИИ',
      this.current ? `сейчас № ${this.current.id}` : null,
      x0 + (bw + gap) * 2,
      y,
      bw,
      bh,
      this.mode === 'scenarios' ? 'primary' : 'neutral'
    );

    p.texture.needsUpdate = true;
    p.dirty = false;
  }

  private drawNotice(): void {
    const p = this.notice;
    const ctx = p.ctx;
    ctx.clearRect(0, 0, p.pxW, p.pxH);
    const colors: Record<string, string> = {
      success: '#22c55e',
      warning: '#eab308',
      danger: '#ef4444',
      info: '#38bdf8'
    };
    const accent = colors[this.noticeType] || colors.info;
    fillRR(ctx, 0, 0, p.pxW, p.pxH, 20, 'rgba(9,13,22,0.94)');
    strokeRR(ctx, 2, 2, p.pxW - 4, p.pxH - 4, 20, accent, 5);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 30px sans-serif';
    ctx.textAlign = 'center';
    const lines = wrapLines(ctx, this.noticeText, p.pxW - 60, 1);
    ctx.fillText(lines[0] || '', p.pxW / 2, p.pxH / 2 + 10);
    ctx.textAlign = 'left';
    p.texture.needsUpdate = true;
    p.dirty = false;
  }

  // ------------------------------------------------------------ drawing: modal
  private drawModal(): void {
    const p = this.modal;
    const ctx = p.ctx;
    p.buttons = [];
    ctx.clearRect(0, 0, p.pxW, p.pxH);

    const isSuccess = this.mode === 'success';
    fillRR(ctx, 0, 0, p.pxW, p.pxH, 28, isSuccess ? 'rgba(4,20,12,0.97)' : 'rgba(9,13,22,0.97)');
    strokeRR(ctx, 3, 3, p.pxW - 6, p.pxH - 6, 28, isSuccess ? '#22c55e' : '#38bdf8', 6);

    // шапка
    const titles: Record<string, string> = {
      scenarios: 'ВЫБОР СЦЕНАРИЯ',
      tasks: 'ЗАДАНИЯ СЦЕНАРИЯ',
      success: 'СЦЕНАРИЙ ВЫПОЛНЕН'
    };
    ctx.fillStyle = isSuccess ? '#4ade80' : '#e2e8f0';
    ctx.font = 'bold 38px sans-serif';
    ctx.fillText(titles[this.mode] || '', 40, 62);
    this.drawButton(p, 'close', '✕', null, 914, 16, 94, 60, 'neutral');

    if (this.mode === 'scenarios') this.drawScenarioList(p);
    else if (this.mode === 'tasks') this.drawTaskList(p);
    else if (this.mode === 'success') this.drawSuccess(p);

    p.texture.needsUpdate = true;
    p.dirty = false;
  }

  private drawScenarioList(p: MenuPanel): void {
    const ctx = p.ctx;
    const pages = Math.max(1, Math.ceil(this.scenarios.length / this.perPage));
    this.page = Math.min(this.page, pages - 1);
    const start = this.page * this.perPage;
    const items = this.scenarios.slice(start, start + this.perPage);

    const rowH = 104;
    const gap = 10;
    let y = 100;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      const id = `scn:${s.id}`;
      const isCurrent = !!this.current && this.current.id === s.id;
      const hovered = p.hovered === id;
      p.buttons.push({ id, x: 36, y, w: 952, h: rowH });

      fillRR(ctx, 36, y, 952, rowH, 16, hovered ? '#334155' : isCurrent ? '#0f2a1d' : '#111827');
      strokeRR(ctx, 36, y, 952, rowH, 16, hovered ? '#facc15' : isCurrent ? '#22c55e' : '#334155', hovered ? 5 : 3);

      ctx.fillStyle = hovered ? '#fef9c3' : '#f1f5f9';
      ctx.font = 'bold 29px sans-serif';
      const t = wrapLines(ctx, `${start + i + 1}. ${s.titleRu}`, isCurrent ? 690 : 880, 1);
      ctx.fillText(t[0] || '', 62, y + 44);

      if (s.facilityRu) {
        ctx.fillStyle = '#94a3b8';
        ctx.font = '22px sans-serif';
        const f = wrapLines(ctx, s.facilityRu, 880, 1);
        ctx.fillText(f[0] || '', 62, y + 80);
      }
      if (isCurrent) {
        ctx.fillStyle = '#4ade80';
        ctx.font = 'bold 22px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('● ТЕКУЩИЙ', 962, y + 44);
        ctx.textAlign = 'left';
      }
      y += rowH + gap;
    }

    if (pages > 1) {
      this.drawButton(p, 'prev', '◀', null, 36, 700, 150, 52, 'neutral');
      this.drawButton(p, 'next', '▶', null, 838, 700, 150, 52, 'neutral');
      ctx.fillStyle = '#94a3b8';
      ctx.font = '24px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(`Страница ${this.page + 1} из ${pages}`, 512, 735);
      ctx.textAlign = 'left';
    }
  }

  private drawTaskList(p: MenuPanel): void {
    const ctx = p.ctx;
    const scen = this.current;
    if (!scen) return;

    ctx.fillStyle = '#fde68a';
    ctx.font = 'bold 26px sans-serif';
    const title = wrapLines(ctx, scen.titleRu, 640, 1);
    ctx.fillText(title[0] || '', 40, 122);

    const total = scen.stages.length;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '24px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`Выполнено: ${this.completedCount()} из ${total}`, 984, 122);
    ctx.textAlign = 'left';

    const top = 146;
    const bottom = 684;
    const gap = 10;
    const n = Math.max(1, total);
    const rowH = Math.min(176, (bottom - top - gap * (n - 1)) / n);
    const taskLines = rowH >= 150 ? 3 : 2;

    let y = top;
    for (let i = 0; i < total; i++) {
      const st = scen.stages[i];
      const done = i < this.step || (this.completed && i <= this.step);
      const isCurrent = !done && i === this.step;

      fillRR(ctx, 36, y, 952, rowH, 16, done ? '#0f2a1d' : isCurrent ? '#2a2410' : '#111827');
      strokeRR(ctx, 36, y, 952, rowH, 16, done ? '#22c55e' : isCurrent ? '#eab308' : '#334155', 3);

      // значок статуса
      const cx = 36 + 56;
      const cy = y + 54;
      ctx.beginPath();
      ctx.arc(cx, cy, 30, 0, Math.PI * 2);
      ctx.fillStyle = done ? '#16a34a' : isCurrent ? '#eab308' : '#334155';
      ctx.fill();
      if (done) {
        drawCheck(ctx, cx, cy, 34, '#ffffff', 7);
      } else {
        ctx.fillStyle = isCurrent ? '#1c1917' : '#cbd5e1';
        ctx.font = 'bold 30px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), cx, cy + 11);
        ctx.textAlign = 'left';
      }

      const tx = 124;
      const maxW = 988 - tx - 20;
      ctx.fillStyle = done ? '#86efac' : isCurrent ? '#fde047' : '#e2e8f0';
      ctx.font = 'bold 27px sans-serif';
      const head = wrapLines(ctx, `${st.titleRu}`, maxW, 1);
      ctx.fillText(head[0] || '', tx, y + 42);

      ctx.fillStyle = '#cbd5e1';
      ctx.font = '23px sans-serif';
      const lines = wrapLines(ctx, st.taskRu, maxW, taskLines);
      let ly = y + 76;
      for (let k = 0; k < lines.length; k++) {
        ctx.fillText(lines[k], tx, ly);
        ly += 29;
      }

      if (isCurrent && st.hintRu && ly + 26 < y + rowH) {
        ctx.fillStyle = '#7dd3fc';
        ctx.font = 'italic 20px sans-serif';
        const hint = wrapLines(ctx, `Подсказка: ${st.hintRu}`, maxW, 1);
        ctx.fillText(hint[0] || '', tx, ly + 4);
      }
      y += rowH + gap;
    }

    this.drawButton(p, 'goto-scn', 'СЦЕНАРИИ', null, 36, 696, 300, 56, 'neutral');
    this.drawButton(p, 'close', 'ЗАКРЫТЬ', null, 688, 696, 300, 56, 'primary');
  }

  private drawSuccess(p: MenuPanel): void {
    const ctx = p.ctx;
    const scen = this.current;

    // большая «галочка»
    ctx.beginPath();
    ctx.arc(512, 200, 76, 0, Math.PI * 2);
    ctx.fillStyle = '#16a34a';
    ctx.fill();
    drawCheck(ctx, 512, 200, 86, '#ffffff', 14);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f1f5f9';
    ctx.font = 'bold 32px sans-serif';
    const titleLines = wrapLines(ctx, scen ? scen.titleRu : '', 900, 2);
    let y = 330;
    for (let i = 0; i < titleLines.length; i++) {
      ctx.fillText(titleLines[i], 512, y);
      y += 40;
    }

    const total = scen ? scen.stages.length : 0;
    const limit = this.stats.limitMsv;
    const pct = limit > 0 ? (this.stats.doseMsv / limit) * 100 : 0;

    y = Math.max(y + 24, 420);
    ctx.font = '28px sans-serif';
    ctx.fillStyle = '#cbd5e1';
    ctx.fillText(`Время выполнения: ${formatTime(this.stats.timeSec)}`, 512, y);
    y += 44;
    ctx.fillText(
      limit > 0
        ? `Доза: ${this.stats.doseMsv.toFixed(4)} мЗв из ${limit.toFixed(3)} мЗв (${pct.toFixed(0)}%)`
        : `Доза: ${this.stats.doseMsv.toFixed(4)} мЗв`,
      512,
      y
    );
    y += 44;
    ctx.fillText(`Заданий выполнено: ${total} из ${total}`, 512, y);
    y += 52;

    let verdict = 'Отлично: доза в пределах принципа ALARA';
    let verdictColor = '#4ade80';
    if (limit > 0 && pct > 100) {
      verdict = 'Внимание: лимит дозы превышен';
      verdictColor = '#f87171';
    } else if (limit > 0 && pct > 50) {
      verdict = 'Выполнено: доза в пределах допустимого лимита';
      verdictColor = '#facc15';
    }
    ctx.fillStyle = verdictColor;
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText(verdict, 512, y);
    ctx.textAlign = 'left';

    const hasNext = this.getNextScenario() !== null;
    this.drawButton(p, 'restart', 'ПОВТОРИТЬ', null, 36, 664, 300, 78, 'neutral');
    if (hasNext) {
      this.drawButton(p, 'next-scn', 'СЛЕДУЮЩИЙ', 'сценарий', 362, 664, 300, 78, 'success');
    } else {
      this.drawButton(p, 'goto-scn', 'ВСЕ СЦЕНАРИИ', null, 362, 664, 300, 78, 'success');
    }
    this.drawButton(p, 'close', 'ЗАКРЫТЬ', null, 688, 664, 300, 78, 'primary');
  }
}
