/**
 * VRHudChip — маленькая постоянная кнопка «СВЕРНУТЬ HUD / ПОКАЗАТЬ HUD».
 *
 * Зачем: у контроллера HTC Vive в WebXR нет надёжной кнопки Menu, а боковая кнопка Grip занята
 * захватом предметов и телепортом. Чип висит слева-внизу в поле зрения, остаётся на месте, даже когда
 * основной HUD свёрнут, и нажимается так же, как всё остальное: навести луч контроллера и нажать курок.
 *
 * Чип не знает, как именно сворачивается HUD: он только вызывает onToggle().
 */

import * as THREE from 'three';

export class VRHudChip {
  public readonly rootGroup = new THREE.Group();
  /** Вызывается при нажатии на чип (должен переключить HUD и вернуть новое состояние через setHudShown) */
  public onToggle: (() => void) | null = null;

  private readonly mesh: THREE.Mesh;
  private readonly canvas = document.createElement('canvas');
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;

  private hudShown = true;
  private hovered = false;
  private dirty = true;

  // «ленивое» следование за игроком (чип не дёргается при каждом повороте головы)
  private placed = false;
  private following = false;
  private readonly anchorFwd = new THREE.Vector3(0, 0, -1);
  private readonly lastFwd = new THREE.Vector3(0, 0, -1);
  private readonly camPos = new THREE.Vector3();
  private readonly fwd = new THREE.Vector3();
  private readonly right = new THREE.Vector3();
  private readonly target = new THREE.Vector3();

  constructor() {
    this.canvas.width = 384;
    this.canvas.height = 120;
    this.ctx = this.canvas.getContext('2d')!;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;

    this.mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(0.2, 0.0625),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        toneMapped: false,
        fog: false
      })
    );
    this.mesh.renderOrder = 1003;
    this.mesh.frustumCulled = false;
    this.rootGroup.name = 'vr_hud_chip';
    this.rootGroup.add(this.mesh);
    this.rootGroup.visible = false;
  }

  public setVisible(visible: boolean): void {
    this.rootGroup.visible = visible;
    if (!visible) {
      this.placed = false; // при следующем входе в VR встанет перед игроком
      this.hovered = false;
    }
  }

  /** Состояние основного HUD: true — показан (на чипе «СВЕРНУТЬ»), false — свёрнут («ПОКАЗАТЬ»). */
  public setHudShown(shown: boolean): void {
    if (this.hudShown !== shown) {
      this.hudShown = shown;
      this.dirty = true;
    }
  }

  public update(dt: number, camera: THREE.Camera): void {
    if (!this.rootGroup.visible) return;

    camera.updateWorldMatrix(true, false);
    camera.getWorldPosition(this.camPos);
    camera.getWorldDirection(this.fwd);
    this.fwd.y = 0;
    if (this.fwd.lengthSq() > 0.05) {
      this.fwd.normalize();
      this.lastFwd.copy(this.fwd);
    } else {
      this.fwd.copy(this.lastFwd);
    }
    this.right.set(-this.fwd.z, 0, this.fwd.x);

    // Слева и ниже линии взгляда, на уровне пояса: не мешает и легко находится глазами
    this.target.copy(this.camPos).addScaledVector(this.fwd, 0.55).addScaledVector(this.right, -0.3);
    this.target.y = this.camPos.y - 0.42;

    const pos = this.mesh.position;
    if (!this.placed) {
      pos.copy(this.target);
      this.anchorFwd.copy(this.fwd);
      this.placed = true;
      this.following = false;
    } else {
      const dx = pos.x - this.target.x;
      const dz = pos.z - this.target.z;
      const dy = pos.y - this.target.y;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (!this.following && (dist > 0.4 || this.anchorFwd.dot(this.fwd) < 0.57 || Math.abs(dy) > 0.3)) {
        this.following = true;
      }
      if (this.following) {
        pos.lerp(this.target, 1 - Math.exp(-5 * dt));
        if (dist < 0.04 && Math.abs(dy) < 0.04) {
          this.following = false;
          this.anchorFwd.copy(this.fwd);
        }
      }
    }
    this.mesh.lookAt(this.camPos);
    this.mesh.updateMatrixWorld(true);

    if (this.dirty) this.draw();
  }

  /** @returns true, если луч сейчас на чипе (для подсветки и показа указки) */
  public updateHover(raycaster: THREE.Raycaster): boolean {
    if (!this.rootGroup.visible) return false;
    const hit = raycaster.intersectObject(this.mesh, false).length > 0;
    if (hit !== this.hovered) {
      this.hovered = hit;
      this.dirty = true;
    }
    return hit;
  }

  /** @returns true, если нажатие пришлось на чип (оно поглощено) */
  public handleSelect(raycaster: THREE.Raycaster): boolean {
    if (!this.rootGroup.visible) return false;
    if (raycaster.intersectObject(this.mesh, false).length === 0) return false;
    this.onToggle?.();
    return true;
  }

  private draw(): void {
    const c = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    c.clearRect(0, 0, W, H);

    const border = this.hovered ? '#facc15' : this.hudShown ? '#38bdf8' : '#eab308';
    c.beginPath();
    c.roundRect(4, 4, W - 8, H - 8, 26);
    c.fillStyle = this.hovered ? 'rgba(51,65,85,0.97)' : 'rgba(9,13,22,0.94)';
    c.fill();
    c.lineWidth = this.hovered ? 8 : 5;
    c.strokeStyle = border;
    c.stroke();

    c.textAlign = 'center';
    c.fillStyle = this.hovered ? '#fef9c3' : '#f1f5f9';
    c.font = 'bold 40px sans-serif';
    c.fillText(this.hudShown ? 'СВЕРНУТЬ HUD' : 'ПОКАЗАТЬ HUD', W / 2, H / 2 + 14);

    this.texture.needsUpdate = true;
    this.dirty = false;
  }

  public dispose(): void {
    this.rootGroup.removeFromParent();
    this.texture.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
