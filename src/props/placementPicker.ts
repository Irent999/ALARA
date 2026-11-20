/**
 * placementPicker.ts — режим расстановки предметов прямо в игре (только для разработки).
 *
 * Зачем: я не вижу геометрию ваших комнат, поэтому координаты в layout.json — мои оценки.
 * Этот режим позволяет ставить предметы мышью на реальные поверхности и копировать готовый JSON.
 *
 *   F7  — убрать последний поставленный предмет
 *   F8  — следующий тип предмета (Shift+F8 — предыдущий)
 *   F9  — поставить выбранный предмет туда, куда смотрит прицел (центр экрана)
 *   F10 — скопировать в буфер весь список "props" текущей комнаты (вставьте в layout.json)
 *
 * Включается только в режиме разработки (npm run dev), в собранном .exe его нет.
 */

import * as THREE from 'three';
import type { PropManager } from './propManager';

export interface PlacementPickerOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  props: PropManager;
  /** Возвращает id текущей комнаты, например `scenario_${activeScenarioId}` */
  getRoomId: () => string;
}

export class PlacementPicker {
  private readonly raycaster = new THREE.Raycaster();
  private readonly toast = document.createElement('div');
  private typeIndex = 0;
  private toastTimer = 0;

  constructor(private readonly o: PlacementPickerOptions) {
    this.toast.style.cssText =
      'position:fixed;top:12px;left:50%;transform:translateX(-50%);z-index:80;pointer-events:none;' +
      'background:rgba(9,13,22,.94);color:#e2e8f0;border:1px solid #facc15;border-radius:10px;' +
      'padding:8px 14px;font:13px system-ui,sans-serif;display:none;max-width:80vw;white-space:pre-wrap;';
    document.body.append(this.toast);
    window.addEventListener('keydown', this.onKey);
    this.say(`Режим расстановки: F8 тип · F9 поставить · F7 отменить · F10 копировать JSON\nТип: ${this.currentType()}`);
  }

  public dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.toast.remove();
  }

  private currentType(): string {
    const ids = this.o.props.getCatalogIds();
    return ids[this.typeIndex % Math.max(1, ids.length)] ?? '(каталог пуст)';
  }

  private say(text: string): void {
    this.toast.textContent = text;
    this.toast.style.display = 'block';
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => (this.toast.style.display = 'none'), 3500);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const ids = this.o.props.getCatalogIds();
    if (ids.length === 0) return;
    const roomId = this.o.getRoomId();

    if (e.code === 'F8') {
      e.preventDefault();
      this.typeIndex = (this.typeIndex + (e.shiftKey ? -1 : 1) + ids.length) % ids.length;
      const entry = this.o.props.getCatalogEntry(this.currentType());
      this.say(`Тип: ${this.currentType()}${entry ? ` — ${entry.name}` : ''}`);
    } else if (e.code === 'F9') {
      e.preventDefault();
      this.place(roomId);
    } else if (e.code === 'F7') {
      e.preventDefault();
      void this.o.props.removeLastPlacement(roomId);
      this.say('Последний предмет убран');
    } else if (e.code === 'F10') {
      e.preventDefault();
      const text = this.o.props.exportRoomProps(roomId);
      console.log(`"props" для ${roomId}:\n${text}`);
      void navigator.clipboard
        .writeText(text)
        .then(() => this.say(`Скопировано в буфер: список props для ${roomId}`))
        .catch(() => this.say('Не удалось скопировать — текст выведен в консоль (F12)'));
    }
  };

  private place(roomId: string): void {
    this.o.camera.updateMatrixWorld();
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.o.camera);

    const hits = this.raycaster.intersectObjects(this.o.scene.children, true).filter(h => {
      const m = h.object as THREE.Mesh;
      if (!m.isMesh || !h.object.visible) return false;
      // игнорируем сами предметы, выделение и служебные панели
      for (let o: THREE.Object3D | null = h.object; o; o = o.parent) {
        if (o.name.startsWith('props:') || o.name === 'vr_menu_root') return false;
      }
      return true;
    });
    if (hits.length === 0) {
      this.say('Прицел ни во что не попал — подойдите ближе к поверхности');
      return;
    }

    const type = this.currentType();
    const pos = this.o.props.worldToRoomLocal(roomId, hits[0].point);
    // Поворачиваем предмет лицом к игроку
    const cam = this.o.camera.getWorldPosition(new THREE.Vector3());
    const yaw = Math.round((Math.atan2(cam.x - hits[0].point.x, cam.z - hits[0].point.z) * 180) / Math.PI);

    void this.o.props.appendPlacement(roomId, { type, position: pos, rotation: [0, yaw, 0] });
    this.say(`Поставлено: ${type} @ [${pos.join(', ')}]`);
  }
}
