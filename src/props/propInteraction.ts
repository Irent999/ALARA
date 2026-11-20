/**
 * propInteraction.ts — наведение, подсветка, подсказка и осмотр мелких предметов.
 *
 *  Десктоп: наведите курсор → контур + подсказка у курсора; клик или клавиша G → «взять» предмет
 *           перед камеру. Тяните мышью — вращение, колесо — приближение, G/Esc — вернуть на место.
 *  VR:      наведите луч контроллера → контур + карточка над предметом; курок → предмет в руке
 *           (вращайте рукой); курок ещё раз → вернуть на место.
 *
 * Подсветка — «инвертированная оболочка» (вершинный шейдер раздувает копию меша по нормалям,
 * рисуются только задние грани). Работает и в WebXR — не требует постобработки, в отличие от OutlinePass.
 */

import * as THREE from 'three';
import type { PlacedProp, PropManager, RenderPart } from './propManager';

// ============================================================================
// Контур
// ============================================================================

class OutlineHighlighter {
  private readonly pool: THREE.Mesh[] = [];
  private readonly material: THREE.ShaderMaterial;

  constructor(private readonly scene: THREE.Scene, color: number, thicknessMeters = 0.004) {
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uThickness: { value: thicknessMeters }
      },
      // Раздувание в МИРОВЫХ координатах → толщина контура одинакова для любого масштаба предмета
      vertexShader: /* glsl */ `
        uniform float uThickness;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 wn = normalize(mat3(modelMatrix) * normal);
          wp.xyz += wn * uThickness;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        void main() {
          gl_FragColor = vec4(uColor, 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      toneMapped: false,
      fog: false
    });
  }

  public show(parts: RenderPart[]): void {
    for (let i = 0; i < parts.length; i++) {
      let mesh = this.pool[i];
      if (!mesh) {
        mesh = new THREE.Mesh(parts[i].geometry, this.material);
        mesh.matrixAutoUpdate = false;
        mesh.frustumCulled = false;
        mesh.renderOrder = 10;
        this.scene.add(mesh);
        this.pool.push(mesh);
      }
      mesh.geometry = parts[i].geometry;
      mesh.matrix.copy(parts[i].matrixWorld);
      mesh.matrixWorldNeedsUpdate = true;
      mesh.visible = true;
    }
    for (let i = parts.length; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  public hide(): void {
    for (const m of this.pool) m.visible = false;
  }

  public dispose(): void {
    for (const m of this.pool) m.removeFromParent();
    this.pool.length = 0;
    this.material.dispose();
  }
}

// ============================================================================
// Карточка в VR (canvas-текстура)
// ============================================================================

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(test).width > maxW) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[\s.,;:]+$/, '')}…`;
  }
  return lines;
}

class VRTooltip {
  public readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private lastKey = '';

  constructor(scene: THREE.Scene) {
    this.canvas.width = 512;
    this.canvas.height = 208;
    this.ctx = this.canvas.getContext('2d')!;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.34, 0.138),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false
      })
    );
    this.mesh.renderOrder = 1002;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    scene.add(this.mesh);
  }

  public show(title: string, desc: string, hint: string, anchor: THREE.Vector3, camPos: THREE.Vector3): void {
    const key = `${title}|${desc}|${hint}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      this.draw(title, desc, hint);
    }
    this.mesh.position.set(anchor.x, anchor.y + 0.13, anchor.z);
    this.mesh.lookAt(camPos);
    this.mesh.visible = true;
  }

  public hide(): void {
    this.mesh.visible = false;
  }

  private draw(title: string, desc: string, hint: string): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(9,13,22,0.94)';
    c.beginPath();
    c.roundRect(0, 0, W, H, 22);
    c.fill();
    c.strokeStyle = '#38bdf8';
    c.lineWidth = 5;
    c.stroke();

    c.fillStyle = '#f8fafc';
    c.font = 'bold 32px sans-serif';
    c.fillText(wrapText(c, title, W - 44, 1)[0] ?? '', 22, 52);

    c.fillStyle = '#cbd5e1';
    c.font = '23px sans-serif';
    let y = 92;
    for (const l of wrapText(c, desc, W - 44, 2)) {
      c.fillText(l, 22, y);
      y += 30;
    }

    c.fillStyle = '#facc15';
    c.font = 'bold 24px sans-serif';
    c.fillText(hint, 22, H - 22);
    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.mesh.removeFromParent();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

// ============================================================================
// DOM-подсказка и карточка осмотра (десктоп)
// ============================================================================

class DesktopOverlay {
  private readonly tip = document.createElement('div');
  private readonly card = document.createElement('div');

  constructor() {
    const base =
      'position:fixed;z-index:60;pointer-events:none;display:none;font-family:system-ui,sans-serif;' +
      'background:rgba(9,13,22,0.94);color:#e2e8f0;border:1px solid #38bdf8;border-radius:12px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.5);';
    this.tip.style.cssText = `${base}padding:10px 14px;max-width:320px;`;
    this.card.style.cssText = `${base}left:50%;bottom:28px;transform:translateX(-50%);padding:14px 20px;max-width:520px;text-align:center;`;
    document.body.append(this.tip, this.card);
  }

  private fill(el: HTMLElement, title: string, desc: string, hint: string): void {
    el.replaceChildren();
    const t = document.createElement('div');
    t.style.cssText = 'font-weight:700;font-size:14px;color:#f8fafc;';
    t.textContent = title;
    el.append(t);
    if (desc) {
      const d = document.createElement('div');
      d.style.cssText = 'font-size:12.5px;margin-top:4px;color:#cbd5e1;line-height:1.35;';
      d.textContent = desc;
      el.append(d);
    }
    const h = document.createElement('div');
    h.style.cssText = 'font-size:12px;margin-top:6px;font-weight:700;color:#facc15;';
    h.textContent = hint;
    el.append(h);
  }

  public showTip(title: string, desc: string, hint: string, x: number, y: number): void {
    this.fill(this.tip, title, desc, hint);
    this.tip.style.display = 'block';
    const w = this.tip.offsetWidth;
    const h = this.tip.offsetHeight;
    this.tip.style.left = `${Math.min(x + 18, window.innerWidth - w - 8)}px`;
    this.tip.style.top = `${Math.min(y + 18, window.innerHeight - h - 8)}px`;
  }

  public hideTip(): void {
    this.tip.style.display = 'none';
  }

  public showCard(title: string, desc: string, hint: string): void {
    this.fill(this.card, title, desc, hint);
    this.card.style.display = 'block';
  }

  public hideCard(): void {
    this.card.style.display = 'none';
  }

  public dispose(): void {
    this.tip.remove();
    this.card.remove();
  }
}

// ============================================================================
// Основной класс
// ============================================================================

export interface PropInteractionOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGLRenderer;
  props: PropManager;
  maxDistanceDesktop?: number; // м, по умолчанию 3
  maxDistanceXR?: number; // м, по умолчанию 5
  /** Клавиша «взять/вернуть» на десктопе (KeyboardEvent.code). По умолчанию 'KeyG' (E уже занята под захват) */
  selectKey?: string;
  /** Брать предмет кликом (без перетаскивания) */
  clickToSelect?: boolean;
  highlightColor?: number;
  /** Вызывается при входе в осмотр — заморозьте движение игрока */
  onInspectStart?: (p: PlacedProp) => void;
  onInspectEnd?: () => void;
}

interface HoverInfo {
  placed: PlacedProp;
  point: THREE.Vector3;
}

interface InspectState {
  placed: PlacedProp;
  root: THREE.Group;
  inner: THREE.Group;
  holder: THREE.Object3D;
  xrIdx: number | null;
  yaw: number;
  pitch: number;
  dist: number;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _box = new THREE.Box3();
const _box2 = new THREE.Box3();

export class PropInteraction {
  private readonly o: Required<
    Pick<PropInteractionOptions, 'maxDistanceDesktop' | 'maxDistanceXR' | 'selectKey' | 'clickToSelect' | 'highlightColor'>
  > &
    PropInteractionOptions;

  private readonly raycaster = new THREE.Raycaster();
  private readonly outline: OutlineHighlighter;
  private readonly overlay = new DesktopOverlay();
  private readonly vrTip: VRTooltip;

  private readonly ndc = new THREE.Vector2();
  private mouseClient = new THREE.Vector2();
  private mouseInside = false;
  private downPos: { x: number; y: number } | null = null;

  private hover: HoverInfo | null = null;
  private readonly xrHover: Array<HoverInfo | null> = [null, null];
  private inspect: InspectState | null = null;
  private attached = false;

  constructor(options: PropInteractionOptions) {
    this.o = {
      maxDistanceDesktop: 3,
      maxDistanceXR: 5,
      selectKey: 'KeyG',
      clickToSelect: true,
      highlightColor: 0xfacc15,
      ...options
    };
    this.outline = new OutlineHighlighter(options.scene, this.o.highlightColor);
    this.vrTip = new VRTooltip(options.scene);
  }

  public get isInspecting(): boolean {
    return this.inspect !== null;
  }

  // ------------------------------------------------------------ подписки
  public attach(): void {
    if (this.attached) return;
    this.attached = true;
    const dom = this.o.renderer.domElement;
    dom.addEventListener('pointermove', this.onPointerMove);
    dom.addEventListener('pointerleave', this.onPointerLeave);
    dom.addEventListener('pointerdown', this.onPointerDown);
    dom.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('keydown', this.onKeyDown);
    // capture: перехватываем ввод ДО остальных обработчиков, пока предмет в руке (иначе камера крутится вместе с ним)
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
      window.addEventListener(t, this.onInspectPointer, { capture: true });
    }
    window.addEventListener('wheel', this.onInspectWheel, { capture: true, passive: false });
  }

  public detach(): void {
    if (!this.attached) return;
    this.attached = false;
    const dom = this.o.renderer.domElement;
    dom.removeEventListener('pointermove', this.onPointerMove);
    dom.removeEventListener('pointerleave', this.onPointerLeave);
    dom.removeEventListener('pointerdown', this.onPointerDown);
    dom.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('keydown', this.onKeyDown);
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'mousedown', 'mousemove', 'mouseup']) {
      window.removeEventListener(t, this.onInspectPointer, { capture: true });
    }
    window.removeEventListener('wheel', this.onInspectWheel, { capture: true });
  }

  public dispose(): void {
    this.exitInspect();
    this.detach();
    this.outline.dispose();
    this.vrTip.dispose();
    this.overlay.dispose();
  }

  // ------------------------------------------------------------ покадровое обновление (десктоп)
  /** Вызывайте каждый кадр из основного цикла (в VR хватает updateHover от контроллеров). */
  public update(_dt: number): void {
    const xr = this.o.renderer.xr.isPresenting;

    // Сессия сменилась, пока предмет в руке → аккуратно возвращаем на место
    if (this.inspect && (this.inspect.xrIdx !== null) !== xr) this.exitInspect();

    if (xr) {
      this.overlay.hideTip();
      this.tickInspect();
      return;
    }
    this.vrTip.hide();

    if (this.inspect) {
      this.overlay.hideTip();
      this.tickInspect();
      return;
    }

    this.o.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(this.mouseInside ? this.ndc : new THREE.Vector2(0, 0), this.o.camera);
    const hit = this.pick(this.raycaster, this.o.maxDistanceDesktop);
    this.setHover(hit);

    if (hit) {
      const d = hit.placed.placement.description ?? hit.placed.def.description ?? '';
      this.overlay.showTip(
        hit.placed.placement.name ?? hit.placed.def.name,
        d,
        this.hintText(hit.placed, false),
        this.mouseInside ? this.mouseClient.x : window.innerWidth / 2,
        this.mouseInside ? this.mouseClient.y : window.innerHeight / 2
      );
    } else {
      this.overlay.hideTip();
    }
  }

  // ------------------------------------------------------------ XR (интерфейс XRPropPointer из webxrManager.ts)
  public updateHover(raycaster: THREE.Raycaster, controllerIdx: number, _controller: THREE.Object3D): void {
    if (this.inspect) return;
    const idx = controllerIdx === 1 ? 1 : 0;
    this.xrHover[idx] = this.pick(raycaster, this.o.maxDistanceXR);

    const hit = this.xrHover[0] ?? this.xrHover[1];
    this.setHover(hit);
    if (hit) {
      const cam = this.o.camera.getWorldPosition(_v);
      this.vrTip.show(
        hit.placed.placement.name ?? hit.placed.def.name,
        hit.placed.placement.description ?? hit.placed.def.description ?? '',
        this.hintText(hit.placed, true),
        hit.point,
        cam
      );
    } else {
      this.vrTip.hide();
    }
  }

  public handleSelect(raycaster: THREE.Raycaster, controllerIdx: number, controller: THREE.Object3D): boolean {
    if (this.inspect) {
      this.exitInspect(); // любой курок возвращает предмет
      return true;
    }
    const hit = this.pick(raycaster, this.o.maxDistanceXR);
    if (!hit) return false;
    this.enterInspect(hit.placed, controller, controllerIdx === 1 ? 1 : 0);
    return true;
  }

  // ------------------------------------------------------------ выбор и подсветка
  private pick(raycaster: THREE.Raycaster, maxDist: number): HoverInfo | null {
    const prevFar = raycaster.far;
    raycaster.far = maxDist;
    const hits = raycaster.intersectObjects(this.o.props.getInteractiveObjects(), true);
    raycaster.far = prevFar;

    for (const h of hits) {
      const placed = this.o.props.resolveHit(h);
      if (placed) return { placed, point: h.point.clone() };
    }
    return null;
  }

  private setHover(info: HoverInfo | null): void {
    const prev = this.hover?.placed;
    this.hover = info;
    if (!info) {
      if (prev) this.outline.hide();
      return;
    }
    if (info.placed !== prev) this.outline.show(this.o.props.getRenderParts(info.placed));
  }

  private hintText(p: PlacedProp, xr: boolean): string {
    const action = p.def.hint ?? 'осмотреть';
    const key = this.o.selectKey.replace(/^Key/, '');
    return xr ? `Курок — ${action}` : `Нажми ${key} или кликни — ${action}`;
  }

  // ------------------------------------------------------------ осмотр
  private enterInspect(placed: PlacedProp, xrHolder: THREE.Object3D | null, xrIdx: number | null): void {
    if (this.inspect) return;

    const parts = this.o.props.getRenderParts(placed);
    if (parts.length === 0) return;

    // Габариты предмета в мировых координатах
    _box.makeEmpty();
    for (const p of parts) {
      if (!p.geometry.boundingBox) p.geometry.computeBoundingBox();
      _box2.copy(p.geometry.boundingBox!).applyMatrix4(p.matrixWorld);
      _box.union(_box2);
    }
    const center = _box.getCenter(new THREE.Vector3());
    const size = _box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z, 1e-4);

    const targetSize = placed.def.inspect?.size ?? 0.18;
    const root = new THREE.Group();
    const inner = new THREE.Group();
    root.add(inner);
    root.scale.setScalar(THREE.MathUtils.clamp(targetSize / maxDim, 0.02, 50));

    // Геометрия и материалы — общие с оригиналом (память не дублируется)
    const toCenter = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    for (const p of parts) {
      const m = new THREE.Mesh(p.geometry, p.material);
      m.matrixAutoUpdate = false;
      m.matrix.multiplyMatrices(toCenter, p.matrixWorld);
      m.frustumCulled = false;
      inner.add(m);
    }

    const dist = placed.def.inspect?.distance ?? 0.45;
    const holder: THREE.Object3D = xrHolder ?? this.o.camera;
    if (xrHolder) root.position.set(0, 0, -0.14);
    else root.position.set(0, -0.02, -dist);
    holder.add(root);

    this.o.props.setHidden(placed, true);
    this.outline.hide();
    this.setHover(null);
    this.vrTip.hide();
    this.overlay.hideTip();

    this.inspect = { placed, root, inner, holder, xrIdx, yaw: 0, pitch: 0, dist };

    if (!xrHolder) {
      this.overlay.showCard(
        placed.placement.name ?? placed.def.name,
        placed.placement.description ?? placed.def.description ?? '',
        `Тяните мышью — вращать · Колесо — приблизить · ${this.o.selectKey.replace(/^Key/, '')} / Esc — вернуть`
      );
    }
    this.o.onInspectStart?.(placed);
  }

  public exitInspect(): void {
    const s = this.inspect;
    if (!s) return;
    this.inspect = null;
    s.holder.remove(s.root);
    this.o.props.setHidden(s.placed, false);
    this.overlay.hideCard();
    this.vrTip.hide();
    this.o.onInspectEnd?.();
  }

  private tickInspect(): void {
    const s = this.inspect;
    if (!s) return;
    s.inner.rotation.set(s.pitch, s.yaw, 0, 'YXZ');
    if (s.xrIdx === null) {
      s.root.position.z = -s.dist;
    } else {
      // Карточка над предметом в руке
      const camPos = this.o.camera.getWorldPosition(_v);
      s.root.getWorldPosition(_v2);
      this.vrTip.show(
        s.placed.placement.name ?? s.placed.def.name,
        s.placed.placement.description ?? s.placed.def.description ?? '',
        'Курок — вернуть на место',
        _v2,
        camPos
      );
    }
  }

  // ------------------------------------------------------------ события десктопа
  private readonly onPointerMove = (e: PointerEvent): void => {
    const r = this.o.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.mouseClient.set(e.clientX, e.clientY);
    this.mouseInside = true;
  };

  private readonly onPointerLeave = (): void => {
    this.mouseInside = false;
  };

  private readonly onPointerDown = (e: PointerEvent): void => {
    this.downPos = { x: e.clientX, y: e.clientY };
  };

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (!this.o.clickToSelect || e.button !== 0 || this.o.renderer.xr.isPresenting) return;
    const d = this.downPos;
    this.downPos = null;
    // Перетаскивание (поворот камеры) не считается кликом
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 6) return;
    if (!this.inspect && this.hover) this.enterInspect(this.hover.placed, null, null);
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (this.o.renderer.xr.isPresenting || e.repeat) return;
    if (e.code === this.o.selectKey) {
      if (this.inspect) this.exitInspect();
      else if (this.hover) this.enterInspect(this.hover.placed, null, null);
    } else if (e.code === 'Escape' && this.inspect) {
      this.exitInspect();
    }
  };

  /** Пока предмет в руке — мышь вращает ЕГО, а не камеру */
  private readonly onInspectPointer = (e: Event): void => {
    const s = this.inspect;
    if (!s || s.xrIdx !== null) return;
    e.stopImmediatePropagation();
    if (e.type === 'pointermove' && (e as PointerEvent).buttons & 1) {
      const pe = e as PointerEvent;
      s.yaw += pe.movementX * 0.01;
      s.pitch = THREE.MathUtils.clamp(s.pitch + pe.movementY * 0.01, -1.5, 1.5);
    }
  };

  private readonly onInspectWheel = (e: WheelEvent): void => {
    const s = this.inspect;
    if (!s || s.xrIdx !== null) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    s.dist = THREE.MathUtils.clamp(s.dist + e.deltaY * 0.0006, 0.25, 0.9);
  };
}
