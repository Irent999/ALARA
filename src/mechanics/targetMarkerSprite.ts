/**
 * ALARA — Лёгкий 3D-маркер цели (CanvasTexture + Sprite) с кэшированием перерисовки.
 * (src/mechanics/targetMarkerSprite.ts)
 *
 * Перерисовывает Canvas только при смене текста/цвета/целых метров дистанции (без GC в update).
 */

import * as THREE from 'three';

export interface TargetMarkerVisualParams {
  readonly title: string;
  readonly subtitle: string;
  readonly accentHex: string;
  readonly bgHex?: string;
}

export class TargetMarkerSprite {
  public readonly sprite: THREE.Sprite;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly material: THREE.SpriteMaterial;
  private lastKey = '';
  private readonly baseWidthM: number;
  private readonly baseHeightM: number;

  constructor(baseWidthM = 2.6, baseHeightM = 0.78) {
    this.baseWidthM = baseWidthM;
    this.baseHeightM = baseHeightM;

    this.canvas = document.createElement('canvas');
    this.canvas.width = 448;
    this.canvas.height = 132;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Не удалось создать 2D-контекст для 3D-маркера цели.');
    }
    this.ctx = ctx;

    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;

    this.material = new THREE.SpriteMaterial({
      map: this.texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      opacity: 0.94
    });

    this.sprite = new THREE.Sprite(this.material);
    this.sprite.renderOrder = 25;
    this.sprite.scale.set(this.baseWidthM, this.baseHeightM, 1);
  }

  /**
   * Обновляет текст/цвет только при реальном изменении содержимого и масштабирует под дистанцию.
   */
  public sync(
    params: TargetMarkerVisualParams,
    distanceM: number,
    visible: boolean,
    opacity = 0.94
  ): void {
    this.sprite.visible = visible;
    if (!visible) return;

    this.material.opacity = opacity;

    // Умеренное масштабирование от дистанции, чтобы метка читалась и на 4 м, и на 50 м
    const distScale = THREE.MathUtils.clamp(0.75 + distanceM * 0.036, 0.85, 2.75);
    this.sprite.scale.set(this.baseWidthM * distScale, this.baseHeightM * distScale, 1);

    const bgHex = params.bgHex ?? 'rgba(11, 17, 23, 0.88)';
    const key = `${params.title}|${params.subtitle}|${params.accentHex}|${bgHex}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const { ctx, canvas } = this;
    const w = canvas.width;
    const h = canvas.height;
    ctx.clearRect(0, 0, w, h);

    // Скруглённая подложка
    const r = 18;
    ctx.beginPath();
    ctx.moveTo(r + 4, 4);
    ctx.lineTo(w - r - 4, 4);
    ctx.quadraticCurveTo(w - 4, 4, w - 4, r + 4);
    ctx.lineTo(w - 4, h - r - 4);
    ctx.quadraticCurveTo(w - 4, h - 4, w - r - 4, h - 4);
    ctx.lineTo(r + 4, h - 4);
    ctx.quadraticCurveTo(4, h - 4, 4, h - r - 4);
    ctx.lineTo(4, r + 4);
    ctx.quadraticCurveTo(4, 4, r + 4, 4);
    ctx.closePath();

    ctx.fillStyle = bgHex;
    ctx.fill();
    ctx.lineWidth = 5;
    ctx.strokeStyle = params.accentHex;
    ctx.stroke();

    // Акцентная вертикальная полоса слева
    ctx.fillStyle = params.accentHex;
    ctx.fillRect(14, 18, 9, h - 36);

    // Заголовок и подзаголовок
    ctx.fillStyle = '#F8FAFC';
    ctx.font = 'bold 31px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(params.title, 36, 46, w - 52);

    ctx.fillStyle = params.accentHex;
    ctx.font = 'bold 23px monospace';
    ctx.fillText(params.subtitle, 36, 90, w - 52);

    this.texture.needsUpdate = true;
  }

  public dispose(): void {
    this.texture.dispose();
    this.material.dispose();
  }
}
