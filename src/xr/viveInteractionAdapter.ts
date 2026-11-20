/**
 * ALARA — Адаптер взаимодействия HTC Vive (WebXR) и Desktop-режима
 * (src/xr/viveInteractionAdapter.ts)
 *
 * Обеспечивает унифицированный расчёт луча прицеливания, якоря правой кисти для ОУ-5,
 * состояния курка/хвата HTC Vive Wand / Controller и клавиш мыши/клавиатуры
 * без аллокаций на кадр.
 */

import * as THREE from 'three';

export type ActiveControlDeviceMode = 'htc_vive_xr' | 'desktop_debug';

export interface ViveAimSample {
  readonly mode: ActiveControlDeviceMode;
  readonly playerWorldPos: THREE.Vector3;
  readonly handAnchorPos: THREE.Vector3;
  readonly handAnchorQuat: THREE.Quaternion;
  readonly hasVrHandQuat: boolean;
  readonly aimOrigin: THREE.Vector3;
  readonly aimDirection: THREE.Vector3;
  readonly inputHintLabelRu: string;
}

export interface VivePollInputs {
  readonly isVR: boolean;
  readonly camera: THREE.Camera;
  readonly vrRightHandAnchor?: THREE.Object3D | null;
  readonly vrRightRaycaster?: THREE.Raycaster | null;
}

export class ViveInteractionAdapter {
  private readonly playerWorldPos = new THREE.Vector3();
  private readonly handAnchorPos = new THREE.Vector3();
  private readonly handAnchorQuat = new THREE.Quaternion();
  private readonly aimOrigin = new THREE.Vector3();
  private readonly aimDirection = new THREE.Vector3(0, 0, -1);
  private readonly scratchRight = new THREE.Vector3();
  private readonly scratchCamUp = new THREE.Vector3();
  private readonly worldUp = new THREE.Vector3(0, 1, 0);

  /**
   * Извлекает актуальный луч прицеливания и эргономичную боковую позицию кисти с контроллера HTC Vive (WebXR)
   * либо с камеры от первого лица (Desktop-режим, строго в правом-нижнем периферийном секторе, вне центра обзора).
   */
  public sampleAim(input: VivePollInputs): ViveAimSample {
    input.camera.getWorldPosition(this.playerWorldPos);

    if (input.isVR && input.vrRightHandAnchor && input.vrRightHandAnchor.visible) {
      input.vrRightHandAnchor.getWorldPosition(this.handAnchorPos);
      input.vrRightHandAnchor.getWorldQuaternion(this.handAnchorQuat);
      if (input.vrRightRaycaster) {
        this.aimOrigin.copy(input.vrRightRaycaster.ray.origin);
        this.aimDirection.copy(input.vrRightRaycaster.ray.direction).normalize();
      } else {
        this.aimOrigin.copy(this.handAnchorPos);
        input.vrRightHandAnchor.getWorldDirection(this.aimDirection).negate().normalize();
      }
      return {
        mode: 'htc_vive_xr',
        playerWorldPos: this.playerWorldPos,
        handAnchorPos: this.handAnchorPos,
        handAnchorQuat: this.handAnchorQuat,
        hasVrHandQuat: true,
        aimOrigin: this.aimOrigin,
        aimDirection: this.aimDirection,
        inputHintLabelRu: 'HTC Vive • Курок: распыл / Выбор • [G]/Грип: убрать ОУ-5 • Стик: шаг'
      };
    }

    this.aimOrigin.copy(this.playerWorldPos);
    input.camera.getWorldDirection(this.aimDirection).normalize();

    this.scratchRight.crossVectors(this.aimDirection, this.worldUp);
    if (this.scratchRight.lengthSq() < 1e-6) {
      this.scratchRight.set(1, 0, 0);
    } else {
      this.scratchRight.normalize();
    }
    this.scratchCamUp.crossVectors(this.scratchRight, this.aimDirection).normalize();

    // Эргономичная позиция кисти в правом-нижнем углу вне центрального сектора камеры
    this.handAnchorPos
      .copy(this.aimOrigin)
      .addScaledVector(this.aimDirection, 0.56)
      .addScaledVector(this.scratchRight, 0.34)
      .addScaledVector(this.scratchCamUp, -0.36);
    if (this.handAnchorPos.y < 0.22) {
      this.handAnchorPos.y = 0.22;
    }
    this.handAnchorQuat.identity();

    return {
      mode: 'desktop_debug',
      playerWorldPos: this.playerWorldPos,
      handAnchorPos: this.handAnchorPos,
      handAnchorQuat: this.handAnchorQuat,
      hasVrHandQuat: false,
      aimOrigin: this.aimOrigin,
      aimDirection: this.aimDirection,
      inputHintLabelRu: 'Desktop • [E]/ЛКМ: действие/распыл • [R]: чека • [G]: убрать ОУ-5'
    };
  }
}
