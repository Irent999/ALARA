/**
 * ALARA-Planner Pro VR - Пространственный 3D VR интерфейс (Three.js Canvas UI)
 * Включает:
 * 1. VR HUD (парящий дозиметрический монитор перед глазами)
 * 2. VR Toast (всплывающие пространственные уведомления)
 * 3. VR GostInstrumentsModal (3D-справочник приборов по ГОСТ 27451-87 с вкладками и кнопками)
 * 4. VR AlaraReportModal (3D-протокол ALARA с реальным графиком Chart.js и кнопками)
 * 5. Единая система лазерного рейкастинга и кликов по 3D кнопкам
 */

import * as THREE from 'three';
import { Chart as ChartJS, registerables } from 'chart.js';
import { GOST_INSTRUMENTS, InstrumentId, InstrumentProfile } from '../instruments/gostInstruments';

ChartJS.register(...registerables);

export interface VRUIState {
  currentDoseRateMicroSv: number;
  cumulativeDoseMsv: number;
  missionTimeSec: number;
  selectedInstrumentId: InstrumentId;
  threatLevel: 'normal' | 'warning' | 'danger';
  zoneName: string;
  scenarioTitle: string;
  scenarioTask: string;
  vitalsBpm: number;
  distanceToSourceM: number;
  isFlashlightOn?: boolean;
  isFlashlightEquipped?: boolean;
  isLowLight?: boolean;
  hapticStrength?: number; // 0.0 .. 1.0 (Настройка силы виброотклика в VR HUD)
  effectiveHapticIntensity?: number; // 0.0 .. 1.0 (Текущая интенсивность вибрации пропорционально dD/dt)
  isHoldingSource?: boolean;
  isVoicePushToTalkActive?: boolean;
  voiceVolumeLevel?: number;
  voiceMode?: 'dictation' | 'commands' | 'hybrid';
  latestVoiceNoteText?: string;
  voiceLogCount?: number;
  // Параметры движка правил ScenarioRulesEngine (80% Warning & Game Over Modal)
  isWarning80Active?: boolean;
  warning80Message?: string;
  doseRatioPercent?: number;
  timeRatioPercent?: number;
  isScenarioFailed?: boolean;
  scenarioFailedTitle?: string;
  scenarioFailedReason?: string;
  scenarioFailedCountdownSec?: number;
  hLimitMsv?: number;
  tMaxSec?: number | null;
  scenarioId?: number;
}

export interface VRSuccessModalData {
  scenarioId: number;
  scenarioTitle: string;
  scenarioTask: string;
  facilityRu?: string;
  missionTimeSec: number;
  cumulativeDoseMsv: number;
  hLimitMsv: number;
  alaraRating?: string;
  completedTasksCount?: number;
  totalTasksCount?: number;
}

export interface VRUIButton {
  id: string;
  x: number; // pixel coords on canvas
  y: number;
  width: number;
  height: number;
  onClick: (normalizedX?: number, px?: number) => void;
}

export type VRGostTabType = 'all' | 'dp5' | 'ion' | 'nai' | 'neutron' | 'formulas';

export interface VRInteractionHit {
  panelId: string;
  buttonId?: string;
  point: THREE.Vector3;
}

export class VRUISystem {
  public rootGroup: THREE.Group;
  private camera: THREE.Camera;

  // 1. VR HUD
  private hudMesh: THREE.Mesh;
  private hudCanvas: HTMLCanvasElement;
  private hudCtx: CanvasRenderingContext2D;
  private hudTexture: THREE.CanvasTexture;
  private hudButtons: VRUIButton[] = [];
  public isHudVisible = true;
  public isHudExpanded = false; // По умолчанию в VR интерфейс свернут в компактную периферийную плашку
  public hoveredButtonId?: string;
  public onOpenGostFromHud?: () => void;
  public onOpenAlaraFromHud?: () => void;
  public onToggleFlashlightFromHud?: () => void;
  public onToggleVoicePttFromHud?: () => void;
  public onChangeHapticStrengthFromHud?: (strength: number) => void;
  public onResetScenarioFromHud?: () => void;
  public onScenarioChange?: (newScenarioId: number) => void;
  public onToggleHudVisibility?: (visible: boolean) => void;
  public onOpenChecklistFromHud?: () => void;
  public onAdvanceStepFromHud?: (targetStep?: number) => void;
  private prevFlashlightOnState?: boolean;
  private prevVoicePttState?: boolean;
  private prevHoveredButtonId?: string;
  private prevHapticStrengthState?: number;
  private prevScenarioFailedState?: boolean;
  private prevScenarioIdState?: number;
  private prevHudExpandedState?: boolean;

  // 2. VR Toast
  private toastMesh: THREE.Mesh;
  private toastCanvas: HTMLCanvasElement;
  private toastCtx: CanvasRenderingContext2D;
  private toastTexture: THREE.CanvasTexture;
  private toastTimer = 0;
  private currentToast: { type: string; title: string; message: string } | null = null;

  // 3. VR GOST Modal
  public gostModalGroup: THREE.Group;
  private gostMesh: THREE.Mesh;
  private gostCanvas: HTMLCanvasElement;
  private gostCtx: CanvasRenderingContext2D;
  private gostTexture: THREE.CanvasTexture;
  private gostButtons: VRUIButton[] = [];
  public isGostModalOpen = false;
  private gostActiveTab: 'all' | 'dp5' | 'ion' | 'nai' | 'neutron' | 'formulas' = 'all';
  private onSelectInstrumentCb: (id: InstrumentId) => void = () => {};
  private onCloseGostCb: () => void = () => {};

  // 4. VR ALARA Report Modal
  public reportModalGroup: THREE.Group;
  private reportMesh: THREE.Mesh;
  private reportCanvas: HTMLCanvasElement;
  private reportCtx: CanvasRenderingContext2D;
  private reportTexture: THREE.CanvasTexture;
  private reportButtons: VRUIButton[] = [];
  public isReportModalOpen = false;
  private offscreenChartCanvas: HTMLCanvasElement;
  private offscreenChartInstance: ChartJS | null = null;
  private onRestartMissionCb: () => void = () => {};
  private onCloseReportCb: () => void = () => {};

  // 5. VR Success Modal (Окно успешного завершения сценария)
  public successModalGroup: THREE.Group;
  private successMesh: THREE.Mesh;
  private successCanvas: HTMLCanvasElement;
  private successCtx: CanvasRenderingContext2D;
  private successTexture: THREE.CanvasTexture;
  private successButtons: VRUIButton[] = [];
  public isSuccessModalOpen = false;
  private currentSuccessData: VRSuccessModalData | null = null;
  public onNextScenarioFromSuccess?: () => void;
  public onRestartScenarioFromSuccess?: () => void;
  public onOpenReportFromSuccess?: () => void;
  private onCloseSuccessCb: () => void = () => {};

  public setHudVisible(visible: boolean): void {
    this.isHudVisible = visible;
    this.hudMesh.visible = visible;
    this.onToggleHudVisibility?.(visible);
  }

  public toggleHudVisibility(): boolean {
    const next = !this.isHudVisible;
    this.setHudVisible(next);
    return next;
  }

  public setHudExpanded(expanded: boolean): void {
    this.isHudExpanded = expanded;
    // В свернутом виде опускаем плашку ниже к периферии взгляда и уменьшаем масштаб
    if (expanded) {
      this.hudMesh.position.set(0, -0.30, -1.45);
      this.hudMesh.rotation.x = -0.15;
      this.hudMesh.scale.set(1, 1, 1);
    } else {
      this.hudMesh.position.set(0, -0.44, -1.40);
      this.hudMesh.rotation.x = -0.24;
      this.hudMesh.scale.set(0.82, 0.82, 1);
    }
    this.lastHudUpdateTime = 0;
  }

  public toggleHudExpanded(): boolean {
    const next = !this.isHudExpanded;
    this.setHudExpanded(next);
    return next;
  }

  // 6. VR Checklist Modal (Чек-лист задач сценария в 3D)
  public checklistModalGroup: THREE.Group;
  private checklistMesh: THREE.Mesh;
  private checklistCanvas: HTMLCanvasElement;
  private checklistCtx: CanvasRenderingContext2D;
  private checklistTexture: THREE.CanvasTexture;
  private checklistButtons: VRUIButton[] = [];
  public isChecklistModalOpen = false;
  private currentChecklistStages: Array<{ titleRu: string; taskRu: string; hintRu?: string; isCompleted: boolean; isCurrent: boolean }> = [];

  // Raycast reticle (точка наведения лазера на UI)
  public reticleMesh: THREE.Mesh;

  // Временные объекты для плавной ориентации (без аллокаций в animation loop)
  private tempVec3 = new THREE.Vector3();
  private tempQuat = new THREE.Quaternion();
  private tempEuler = new THREE.Euler(0, 0, 0, 'YXZ');
  private tempYawQuat = new THREE.Quaternion();
  private static readonly UP_VECTOR = new THREE.Vector3(0, 1, 0);
  private lastHudUpdateTime = 0;

  constructor(camera: THREE.Camera) {
    this.camera = camera;
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'VRUISystemRoot';
    this.rootGroup.visible = false; // По умолчанию скрыт для Desktop режима

    // --- Точка прицела Reticle ---
    const reticleGeo = new THREE.RingGeometry(0.008, 0.016, 24);
    const reticleMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
      depthTest: false
    });
    this.reticleMesh = new THREE.Mesh(reticleGeo, reticleMat);
    this.reticleMesh.visible = false;
    this.rootGroup.add(this.reticleMesh);

    // ==========================================
    // 1. Инициализация VR HUD
    // ==========================================
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = 1024;
    this.hudCanvas.height = 576;
    this.hudCtx = this.hudCanvas.getContext('2d')!;
    this.hudTexture = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTexture.minFilter = THREE.LinearFilter;
    this.hudTexture.magFilter = THREE.LinearFilter;

    const hudGeo = new THREE.PlaneGeometry(0.85, 0.48);
    const hudMat = new THREE.MeshBasicMaterial({
      map: this.hudTexture,
      transparent: true,
      opacity: 0.94,
      side: THREE.DoubleSide
    });
    this.hudMesh = new THREE.Mesh(hudGeo, hudMat);
    // По умолчанию HUD свернут к нижней периферии обзора, освобождая 95% 3D-сцены в шлеме
    this.setHudExpanded(false);
    this.rootGroup.add(this.hudMesh);

    // ==========================================
    // 2. Инициализация VR Toast
    // ==========================================
    this.toastCanvas = document.createElement('canvas');
    this.toastCanvas.width = 800;
    this.toastCanvas.height = 200;
    this.toastCtx = this.toastCanvas.getContext('2d')!;
    this.toastTexture = new THREE.CanvasTexture(this.toastCanvas);
    this.toastTexture.minFilter = THREE.LinearFilter;
    this.toastTexture.magFilter = THREE.LinearFilter;

    const toastGeo = new THREE.PlaneGeometry(0.68, 0.17);
    const toastMat = new THREE.MeshBasicMaterial({
      map: this.toastTexture,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });
    this.toastMesh = new THREE.Mesh(toastGeo, toastMat);
    this.toastMesh.position.set(0, 0.38, -1.45);
    this.toastMesh.rotation.x = 0.15;
    this.toastMesh.visible = false;
    this.rootGroup.add(this.toastMesh);

    // ==========================================
    // 3. Инициализация VR GOST Modal
    // ==========================================
    this.gostModalGroup = new THREE.Group();
    this.gostCanvas = document.createElement('canvas');
    this.gostCanvas.width = 1200;
    this.gostCanvas.height = 800;
    this.gostCtx = this.gostCanvas.getContext('2d')!;
    this.gostTexture = new THREE.CanvasTexture(this.gostCanvas);
    this.gostTexture.minFilter = THREE.LinearFilter;
    this.gostTexture.magFilter = THREE.LinearFilter;

    const gostGeo = new THREE.PlaneGeometry(1.35, 0.90);
    const gostMat = new THREE.MeshBasicMaterial({
      map: this.gostTexture,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    this.gostMesh = new THREE.Mesh(gostGeo, gostMat);
    this.gostModalGroup.add(this.gostMesh);
    this.gostModalGroup.position.set(0, 0, -1.35);
    this.gostModalGroup.visible = false;
    this.rootGroup.add(this.gostModalGroup);

    // ==========================================
    // 4. Инициализация VR ALARA Report Modal
    // ==========================================
    this.reportModalGroup = new THREE.Group();
    this.reportCanvas = document.createElement('canvas');
    this.reportCanvas.width = 1200;
    this.reportCanvas.height = 800;
    this.reportCtx = this.reportCanvas.getContext('2d')!;
    this.reportTexture = new THREE.CanvasTexture(this.reportCanvas);
    this.reportTexture.minFilter = THREE.LinearFilter;
    this.reportTexture.magFilter = THREE.LinearFilter;

    // Вспомогательный offscreen canvas для отрисовки Chart.js
    this.offscreenChartCanvas = document.createElement('canvas');
    this.offscreenChartCanvas.width = 750;
    this.offscreenChartCanvas.height = 240;

    const reportGeo = new THREE.PlaneGeometry(1.35, 0.90);
    const reportMat = new THREE.MeshBasicMaterial({
      map: this.reportTexture,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    this.reportMesh = new THREE.Mesh(reportGeo, reportMat);
    this.reportModalGroup.add(this.reportMesh);
    this.reportModalGroup.position.set(0, 0, -1.35);
    this.reportModalGroup.visible = false;
    this.rootGroup.add(this.reportModalGroup);

    // ==========================================
    // 5. Инициализация VR Success Modal
    // ==========================================
    this.successModalGroup = new THREE.Group();
    this.successCanvas = document.createElement('canvas');
    this.successCanvas.width = 1200;
    this.successCanvas.height = 800;
    this.successCtx = this.successCanvas.getContext('2d')!;
    this.successTexture = new THREE.CanvasTexture(this.successCanvas);
    this.successTexture.minFilter = THREE.LinearFilter;
    this.successTexture.magFilter = THREE.LinearFilter;

    const successGeo = new THREE.PlaneGeometry(1.35, 0.90);
    const successMat = new THREE.MeshBasicMaterial({
      map: this.successTexture,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    this.successMesh = new THREE.Mesh(successGeo, successMat);
    this.successModalGroup.add(this.successMesh);
    this.successModalGroup.position.set(0, 0, -1.35);
    this.successModalGroup.visible = false;
    this.rootGroup.add(this.successModalGroup);

    // ==========================================
    // 6. Инициализация VR Checklist Modal
    // ==========================================
    this.checklistModalGroup = new THREE.Group();
    this.checklistCanvas = document.createElement('canvas');
    this.checklistCanvas.width = 1200;
    this.checklistCanvas.height = 800;
    this.checklistCtx = this.checklistCanvas.getContext('2d')!;
    this.checklistTexture = new THREE.CanvasTexture(this.checklistCanvas);
    this.checklistTexture.minFilter = THREE.LinearFilter;
    this.checklistTexture.magFilter = THREE.LinearFilter;

    const checklistGeo = new THREE.PlaneGeometry(1.35, 0.90);
    const checklistMat = new THREE.MeshBasicMaterial({
      map: this.checklistTexture,
      transparent: true,
      opacity: 0.98,
      side: THREE.DoubleSide
    });
    this.checklistMesh = new THREE.Mesh(checklistGeo, checklistMat);
    this.checklistModalGroup.add(this.checklistMesh);
    this.checklistModalGroup.position.set(0, 0, -1.35);
    this.checklistModalGroup.visible = false;
    this.rootGroup.add(this.checklistModalGroup);
  }

  /**
   * Обновление положения HUD и модальных окон в пространстве игрока
   * Плавно ориентирует VR UI в направлении взгляда пользователя
   */
  public updateOrientation(dt: number, xrCamera: THREE.Camera): void {
    // Получаем мировое положение и ориентацию камеры гарнитуры
    xrCamera.getWorldPosition(this.tempVec3);
    xrCamera.getWorldQuaternion(this.tempQuat);

    // Извлекаем только горизонтальное вращение вокруг вертикальной оси (Yaw),
    // отсекая наклоны головы вверх/вниз (Pitch/Roll) для комфортного восприятия
    this.tempEuler.setFromQuaternion(this.tempQuat, 'YXZ');
    this.tempYawQuat.setFromAxisAngle(VRUISystem.UP_VECTOR, this.tempEuler.y);

    // Привязываем UI к камере с плавным горизонтальным сглаживанием
    this.rootGroup.position.lerp(this.tempVec3, Math.min(1.0, dt * 10.0));
    this.rootGroup.quaternion.slerp(this.tempYawQuat, Math.min(1.0, dt * 5.0));

    // Обновление таймера тоста
    if (this.currentToast && this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.clearToast();
      }
    }
  }

  // =========================================================================
  // Отрисовка VR HUD
  // =========================================================================
  public renderHUD(state: VRUIState): void {
    // Синхронизация видимости 3D-планшета в VR
    this.hudMesh.visible = this.isHudVisible;
    if (!this.isHudVisible) {
      this.hudButtons = [];
      return;
    }

    const now = performance.now();
    const hapticStrength = state.hapticStrength ?? 1.0;
    const effectiveHaptic = state.effectiveHapticIntensity ?? 0.0;
    const curScenarioId = state.scenarioId ?? 1;
    const stateChanged =
      this.prevFlashlightOnState !== state.isFlashlightOn ||
      this.prevVoicePttState !== state.isVoicePushToTalkActive ||
      this.prevHoveredButtonId !== this.hoveredButtonId ||
      this.prevHapticStrengthState !== hapticStrength ||
      this.prevScenarioFailedState !== state.isScenarioFailed ||
      this.prevScenarioIdState !== curScenarioId ||
      this.prevHudExpandedState !== this.isHudExpanded;
    if (!stateChanged && now - this.lastHudUpdateTime < 100) return;

    this.lastHudUpdateTime = now;
    this.prevFlashlightOnState = state.isFlashlightOn;
    this.prevVoicePttState = state.isVoicePushToTalkActive;
    this.prevHoveredButtonId = this.hoveredButtonId;
    this.prevHapticStrengthState = hapticStrength;
    this.prevScenarioFailedState = state.isScenarioFailed;
    this.prevScenarioIdState = curScenarioId;
    this.prevHudExpandedState = this.isHudExpanded;

    const ctx = this.hudCtx;
    const w = this.hudCanvas.width;
    const h = this.hudCanvas.height;

    ctx.clearRect(0, 0, w, h);

    // =========================================================================
    // ЭКРАН ПРОВАЛА (SCENARIO FAILED MODAL) В VR HUD С 5-СЕКУНДНЫМ ОТСЧЕТОМ
    // =========================================================================
    if (state.isScenarioFailed) {
      this.hudButtons = [];
      ctx.fillStyle = 'rgba(28, 6, 10, 0.97)';
      this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

      const pulseFail = 0.55 + 0.45 * Math.sin(now * 0.008);
      ctx.strokeStyle = `rgba(239, 68, 68, ${pulseFail.toFixed(2)})`;
      ctx.lineWidth = 6;
      this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

      // Верхний красный баннер
      ctx.fillStyle = 'rgba(153, 27, 27, 0.55)';
      this.fillRoundedRect(ctx, 28, 28, w - 56, 86, 16);

      ctx.fillStyle = '#fca5a5';
      ctx.font = 'bold 18px monospace';
      ctx.fillText('⛔ SCENARIO FAILED • ДВИЖОК КОНТРОЛЯ ПРАВИЛ ALARA (ПЕРЕМЕЩЕНИЕ ЗАБЛОКИРОВАНО)', 48, 60);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 28px sans-serif';
      ctx.fillText(state.scenarioFailedTitle || 'СЦЕНАРИЙ ПРОВАЛЕН: КРИТИЧЕСКОЕ НАРУШЕНИЕ', 48, 96);

      // Контекстная причина провала
      ctx.fillStyle = 'rgba(69, 10, 10, 0.78)';
      this.fillRoundedRect(ctx, 28, 130, w - 56, 150, 16);
      ctx.strokeStyle = 'rgba(248, 113, 113, 0.45)';
      ctx.lineWidth = 2;
      this.strokeRoundedRect(ctx, 28, 130, w - 56, 150, 16);

      ctx.fillStyle = '#fecaca';
      ctx.font = 'bold 16px monospace';
      ctx.fillText('КОНТЕКСТНАЯ ПРИЧИНА АВАРИЙНОЙ ОСТАНОВКИ:', 48, 162);

      ctx.fillStyle = '#fef2f2';
      ctx.font = '20px sans-serif';
      const reasonText = state.scenarioFailedReason || 'Нарушение регламента радиационной безопасности.';
      const words = reasonText.split(' ');
      let line = '';
      let lineY = 196;
      for (const word of words) {
        if ((line + word).length > 74) {
          ctx.fillText(line.trim(), 48, lineY);
          line = word + ' ';
          lineY += 28;
        } else {
          line += word + ' ';
        }
      }
      if (line.trim() && lineY <= 260) {
        ctx.fillText(line.trim(), 48, lineY);
      }

      // Метрики и 5-секундный обратный отсчет до полного сброса resetScenario()
      const countdown = Math.max(0, state.scenarioFailedCountdownSec ?? 5.0);
      ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
      this.fillRoundedRect(ctx, 28, 296, w - 56, 118, 16);

      ctx.fillStyle = '#f87171';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(
        `H_accum: ${state.cumulativeDoseMsv.toFixed(4)} / ${(state.hLimitMsv ?? 0.2).toFixed(3)} мЗв`,
        48,
        336
      );

      ctx.fillStyle = '#fbbf24';
      ctx.font = 'bold 26px monospace';
      ctx.fillText(
        `⏱ АВТОСБРОС СЦЕНАРИЯ ЧЕРЕЗ: ${countdown.toFixed(1)} СЕК`,
        48,
        376
      );

      // Прогресс-бар 5-секундного отсчета
      const barX = 48;
      const barY = 390;
      const barW = w - 96;
      ctx.fillStyle = '#1e293b';
      this.fillRoundedRect(ctx, barX, barY, barW, 12, 6);
      ctx.fillStyle = '#ef4444';
      this.fillRoundedRect(ctx, barX, barY, Math.max(12, barW * Math.min(1, countdown / 5.0)), 12, 6);

      // Кнопка немедленного перезапуска resetScenario() в VR
      const rstX = 28;
      const rstY = 432;
      const rstW = w - 56;
      const rstH = 108;
      const isRstHover = this.hoveredButtonId === 'vr_reset_scenario';
      ctx.fillStyle = isRstHover ? '#dc2626' : '#991b1b';
      this.fillRoundedRect(ctx, rstX, rstY, rstW, rstH, 18);
      ctx.strokeStyle = isRstHover ? '#fde047' : '#f87171';
      ctx.lineWidth = 4;
      this.strokeRoundedRect(ctx, rstX, rstY, rstW, rstH, 18);

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 26px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🔄 СБРОСИТЬ И ПЕРЕЗАПУСТИТЬ СЦЕНАРИЙ СЕЙЧАС (resetScenario)', w / 2, rstY + 48);
      ctx.fillStyle = '#fecaca';
      ctx.font = '16px monospace';
      ctx.fillText('Возврат на спавн • Обнуление H_accum = 0 • Очистка графиков D(t)/H(t) и CSV', w / 2, rstY + 82);
      ctx.textAlign = 'left';

      this.hudButtons.push({
        id: 'vr_reset_scenario',
        x: rstX,
        y: rstY,
        width: rstW,
        height: rstH,
        onClick: () => {
          this.onResetScenarioFromHud?.();
        }
      });

      this.hudTexture.needsUpdate = true;
      return;
    }

    // =========================================================================
    // СВЕРНУТЫЙ ПЕРИФЕРИЙНЫЙ РЕЖИМ VR HUD (Collapsible Compact Bar)
    // Не перекрывает обзор в шлеме: компактная полупрозрачная полоса в нижней части
    // =========================================================================
    if (!this.isHudExpanded) {
      this.hudButtons = [];
      const barY = h - 146;
      const barH = 132;
      const isDangerCompact = state.threatLevel === 'danger';
      const isWarnCompact = state.threatLevel === 'warning' || Boolean(state.isWarning80Active);
      const borderCol = isDangerCompact ? '#ef4444' : isWarnCompact ? '#facc15' : 'rgba(56, 189, 248, 0.55)';

      ctx.fillStyle = 'rgba(8, 13, 24, 0.82)';
      this.fillRoundedRect(ctx, 20, barY, w - 40, barH, 24);
      ctx.strokeStyle = borderCol;
      ctx.lineWidth = state.isWarning80Active ? 5 : 2.5;
      this.strokeRoundedRect(ctx, 20, barY, w - 40, barH, 24);

      // Левая часть: ключевая телеметрия дозы
      ctx.fillStyle = isDangerCompact ? '#f87171' : isWarnCompact ? '#facc15' : '#34d399';
      ctx.font = 'bold 42px monospace';
      const rateCompact =
        state.currentDoseRateMicroSv >= 1000
          ? `${(state.currentDoseRateMicroSv / 1000).toFixed(2)} мЗв/ч`
          : `${state.currentDoseRateMicroSv.toFixed(1)} мкЗв/ч`;
      ctx.fillText(rateCompact, 48, barY + 62);

      ctx.fillStyle = '#94a3b8';
      ctx.font = 'bold 18px monospace';
      const distCompact = state.distanceToSourceM > 0 && state.distanceToSourceM < 99 ? `${state.distanceToSourceM.toFixed(2)}м` : '—';
      ctx.fillText(
        `H: ${state.cumulativeDoseMsv.toFixed(4)} мЗв  •  r=${distCompact}  •  ${state.zoneName}`,
        48,
        barY + 102
      );

      // Кнопка быстрого фонаря
      const flX = 568;
      const flW = 112;
      const btnY = barY + 22;
      const btnH = 88;
      const isFlHov = this.hoveredButtonId === 'compact_flash';
      ctx.fillStyle = isFlHov ? '#334155' : state.isFlashlightOn ? 'rgba(234, 179, 8, 0.25)' : 'rgba(15, 23, 42, 0.9)';
      this.fillRoundedRect(ctx, flX, btnY, flW, btnH, 16);
      ctx.strokeStyle = isFlHov ? '#facc15' : state.isFlashlightOn ? '#fde047' : '#475569';
      ctx.lineWidth = 2;
      this.strokeRoundedRect(ctx, flX, btnY, flW, btnH, 16);
      ctx.fillStyle = state.isFlashlightOn ? '#fde047' : '#cbd5e1';
      ctx.font = 'bold 18px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(state.isFlashlightOn ? '🔦 ВКЛ' : '🔦 ВЫКЛ', flX + flW / 2, btnY + 52);
      ctx.textAlign = 'left';
      this.hudButtons.push({
        id: 'compact_flash',
        x: flX,
        y: btnY,
        width: flW,
        height: btnH,
        onClick: () => this.onToggleFlashlightFromHud?.()
      });

      // Кнопка «РАЗВЕРНУТЬ МЕНЮ»
      const expX = 694;
      const expW = 200;
      const isExpHov = this.hoveredButtonId === 'hud_expand';
      ctx.fillStyle = isExpHov ? '#0284c7' : 'rgba(14, 165, 233, 0.24)';
      this.fillRoundedRect(ctx, expX, btnY, expW, btnH, 16);
      ctx.strokeStyle = isExpHov ? '#facc15' : '#38bdf8';
      ctx.lineWidth = 2.5;
      this.strokeRoundedRect(ctx, expX, btnY, expW, btnH, 16);
      ctx.fillStyle = '#e0f2fe';
      ctx.font = 'bold 19px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⤢ РАЗВЕРНУТЬ', expX + expW / 2, btnY + 52);
      ctx.textAlign = 'left';
      this.hudButtons.push({
        id: 'hud_expand',
        x: expX,
        y: btnY,
        width: expW,
        height: btnH,
        onClick: () => {
          this.setHudExpanded(true);
        }
      });

      // Кнопка «СКРЫТЬ»
      const hideX = 908;
      const hideW = 80;
      const isHideHov = this.hoveredButtonId === 'hud_hide_completely';
      ctx.fillStyle = isHideHov ? '#991b1b' : 'rgba(30, 41, 59, 0.9)';
      this.fillRoundedRect(ctx, hideX, btnY, hideW, btnH, 16);
      ctx.strokeStyle = isHideHov ? '#facc15' : '#64748b';
      ctx.lineWidth = 2;
      this.strokeRoundedRect(ctx, hideX, btnY, hideW, btnH, 16);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 22px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('👁', hideX + hideW / 2, btnY + 54);
      ctx.textAlign = 'left';
      this.hudButtons.push({
        id: 'hud_hide_completely',
        x: hideX,
        y: btnY,
        width: hideW,
        height: btnH,
        onClick: () => {
          this.setHudVisible(false);
        }
      });

      this.hudTexture.needsUpdate = true;
      return;
    }

    // Фон с легким скруглением (развернутый VR HUD)
    this.hudButtons = [];
    ctx.fillStyle = 'rgba(10, 15, 26, 0.88)';
    this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // Пульсирующий красный оверлей на VR HUD при достижении 80% порога дозы H_limit (Мигание визора)
    if (state.isWarning80Active) {
      const warnPulse = 0.35 + 0.35 * (0.5 + 0.5 * Math.sin(now * 0.015));
      ctx.fillStyle = `rgba(239, 68, 68, ${(warnPulse * 0.40).toFixed(3)})`;
      this.fillRoundedRect(ctx, 14, 14, w - 28, h - 28, 22);
      ctx.strokeStyle = `rgba(239, 68, 68, ${Math.min(1, warnPulse + 0.60).toFixed(2)})`;
      ctx.lineWidth = 10;
      this.strokeRoundedRect(ctx, 14, 14, w - 28, h - 28, 22);
    }

    // Рамка уровня опасности
    const isDanger = state.threatLevel === 'danger';
    const isWarning = state.threatLevel === 'warning' || Boolean(state.isWarning80Active);
    ctx.strokeStyle = isDanger ? '#ef4444' : isWarning ? '#facc15' : '#10b981';
    ctx.lineWidth = state.isWarning80Active ? 5 : 4;
    this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // 1. Шапка (Header) + кнопка «СВЕРНУТЬ» справа
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 20px monospace';
    ctx.fillText('ALARA-PLANNER PRO VR • ГОСТ Р 8.804', 36, 50);

    const collapseBtnX = w - 204;
    const collapseBtnY = 22;
    const collapseBtnW = 168;
    const collapseBtnH = 38;
    const isColHov = this.hoveredButtonId === 'hud_collapse';
    ctx.fillStyle = isColHov ? '#334155' : 'rgba(30, 41, 59, 0.9)';
    this.fillRoundedRect(ctx, collapseBtnX, collapseBtnY, collapseBtnW, collapseBtnH, 10);
    ctx.strokeStyle = isColHov ? '#facc15' : '#38bdf8';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, collapseBtnX, collapseBtnY, collapseBtnW, collapseBtnH, 10);
    ctx.fillStyle = '#e0f2fe';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⤡ СВЕРНУТЬ HUD', collapseBtnX + collapseBtnW / 2, collapseBtnY + 25);
    ctx.textAlign = 'left';
    this.hudButtons.push({
      id: 'hud_collapse',
      x: collapseBtnX,
      y: collapseBtnY,
      width: collapseBtnW,
      height: collapseBtnH,
      onClick: () => {
        this.setHudExpanded(false);
      }
    });

    ctx.fillStyle = isDanger ? '#f87171' : isWarning ? '#fbbf24' : '#34d399';
    ctx.font = 'bold 18px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(`● ${state.zoneName}`, collapseBtnX - 18, 48);
    ctx.textAlign = 'left';

    // Горизонтальный разделитель
    ctx.strokeStyle = 'rgba(51, 65, 85, 0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(36, 72);
    ctx.lineTo(w - 36, 72);
    ctx.stroke();

    // 2. Блок дозиметрии (слева)
    // Мощность дозы dD/dt
    ctx.fillStyle = '#64748b';
    ctx.font = '16px monospace';
    ctx.fillText('ТЕКУЩАЯ МОЩНОСТЬ ДОЗЫ (dD/dt):', 36, 104);

    ctx.fillStyle = isDanger ? '#ef4444' : isWarning ? '#f59e0b' : '#10b981';
    ctx.font = 'bold 54px monospace';
    const rateText = state.currentDoseRateMicroSv >= 1000
      ? (state.currentDoseRateMicroSv / 1000).toFixed(2) + ' мЗв/ч'
      : state.currentDoseRateMicroSv.toFixed(1) + ' мкЗв/ч';
    ctx.fillText(rateText, 36, 160);

    // Накопленная доза и предел сценария H_limit
    ctx.fillStyle = state.isWarning80Active ? '#facc15' : '#94a3b8';
    ctx.font = 'bold 20px monospace';
    const hLimStr = state.hLimitMsv ? ` / ${state.hLimitMsv.toFixed(3)} мЗв (${Math.round(state.doseRatioPercent ?? 0)}%)` : ' мЗв';
    ctx.fillText(`Накоплено: ${state.cumulativeDoseMsv.toFixed(4)}${hLimStr}`, 36, 202);

    // Дистанция до источника
    const distStr = state.distanceToSourceM > 0 ? `${state.distanceToSourceM.toFixed(2)} м` : '—';
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 20px monospace';
    ctx.fillText(`Дистанция: ${distStr}  •  Пульс: ${state.vitalsBpm} уд/мин`, 36, 238);

    // 3. Блок сценария и задачи (справа)
    const midX = 520;

    // Интерактивные кнопки выбора сценария в VR: [ ◀ СЦЕНАРИЙ ] [ # / 4 ] [ СЦЕНАРИЙ ▶ ]
    const scenBtnY = 96;
    const scenBtnH = 34;
    const prevBtnW = 100;
    const nextBtnW = 100;

    const isPrevHover = this.hoveredButtonId === 'scenario_prev';
    ctx.fillStyle = isPrevHover ? '#334155' : '#1e293b';
    this.fillRoundedRect(ctx, midX, scenBtnY, prevBtnW, scenBtnH, 8);
    ctx.strokeStyle = isPrevHover ? '#facc15' : '#475569';
    ctx.lineWidth = isPrevHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, midX, scenBtnY, prevBtnW, scenBtnH, 8);
    ctx.fillStyle = isPrevHover ? '#facc15' : '#cbd5e1';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('◀ НАЗАД', midX + 16, scenBtnY + 22);

    this.hudButtons.push({
      id: 'scenario_prev',
      x: midX,
      y: scenBtnY,
      width: prevBtnW,
      height: scenBtnH,
      onClick: () => {
        const prevId = curScenarioId <= 1 ? 4 : curScenarioId - 1;
        this.onScenarioChange?.(prevId);
      }
    });

    const isNextHover = this.hoveredButtonId === 'scenario_next';
    const nextX = w - 36 - nextBtnW;
    ctx.fillStyle = isNextHover ? '#334155' : '#1e293b';
    this.fillRoundedRect(ctx, nextX, scenBtnY, nextBtnW, scenBtnH, 8);
    ctx.strokeStyle = isNextHover ? '#facc15' : '#475569';
    ctx.lineWidth = isNextHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, nextX, scenBtnY, nextBtnW, scenBtnH, 8);
    ctx.fillStyle = isNextHover ? '#facc15' : '#cbd5e1';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('ВПЕРЕД ▶', nextX + 14, scenBtnY + 22);

    this.hudButtons.push({
      id: 'scenario_next',
      x: nextX,
      y: scenBtnY,
      width: nextBtnW,
      height: scenBtnH,
      onClick: () => {
        const nextId = (curScenarioId % 4) + 1;
        this.onScenarioChange?.(nextId);
      }
    });

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`СЦЕНАРИЙ ${curScenarioId} / 4`, midX + prevBtnW + 16, scenBtnY + 22);

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 21px sans-serif';
    const cleanScenTitle = state.scenarioTitle.length > 36 ? state.scenarioTitle.slice(0, 34) + '...' : state.scenarioTitle;
    ctx.fillText(cleanScenTitle, midX, 158);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '17px sans-serif';
    const cleanTask = state.scenarioTask.length > 48 ? state.scenarioTask.slice(0, 46) + '...' : state.scenarioTask;
    ctx.fillText(`Задание: ${cleanTask}`, midX, 186);

    // Прибор и обратный отсчет таймера миссии (Countdown Timer)
    const tMax = state.tMaxSec || 300;
    const remainingSec = Math.max(0, tMax - state.missionTimeSec);
    const remMins = Math.floor(remainingSec / 60);
    const remSecs = Math.floor(remainingSec % 60);
    const countdownStr = `${remMins.toString().padStart(2, '0')}:${remSecs.toString().padStart(2, '0')}`;

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 17px monospace';
    ctx.fillText(`Прибор: ${GOST_INSTRUMENTS[state.selectedInstrumentId]?.name || 'МКС'}`, midX, 214);

    const isUrgent = remainingSec <= 45;
    ctx.fillStyle = isUrgent
      ? '#ef4444'
      : state.isWarning80Active
      ? '#f59e0b'
      : '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(
      `⏱ ОБРАТНЫЙ ОТСЧЕТ: ${countdownStr} / норма ${tMax}с`,
      midX,
      240
    );

    // =========================================================================
    // 4. Блок настроек VR HUD: Ползунок силы виброотклика (Haptic Feedback Slider ∝ dD/dt)
    // =========================================================================
    const setX = 36;
    const setY = 256;
    const setW = w - 72;
    const setH = 112;

    ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
    this.fillRoundedRect(ctx, setX, setY, setW, setH, 16);
    ctx.strokeStyle =
      this.hoveredButtonId?.startsWith('haptic_') ? '#facc15' : 'rgba(56, 189, 248, 0.45)';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, setX, setY, setW, setH, 16);

    const strengthPct = Math.round(hapticStrength * 100);
    const effectivePct = Math.round(effectiveHaptic * 100);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(
      `⚙️ НАСТРОЙКИ VR HUD • СИЛА ВИБРООТКЛИКА (HAPTIC FEEDBACK): ${strengthPct}%`,
      setX + 18,
      setY + 28
    );

    ctx.textAlign = 'right';
    ctx.fillStyle = effectivePct > 65 ? '#f87171' : effectivePct > 20 ? '#fbbf24' : '#38bdf8';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(
      `Вибрация ∝ dD/dt: ${effectivePct}%${state.isHoldingSource ? ' [ИСТОЧНИК В РУКЕ]' : ''}`,
      setX + setW - 18,
      setY + 28
    );
    ctx.textAlign = 'left';

    const ctrlY = setY + 42;
    const ctrlH = 54;

    // Кнопка [-] уменьшения силы виброотклика
    const decX = setX + 18;
    const decW = 64;
    const isDecHover = this.hoveredButtonId === 'haptic_dec';
    ctx.fillStyle = isDecHover ? '#334155' : '#1e293b';
    this.fillRoundedRect(ctx, decX, ctrlY, decW, ctrlH, 12);
    ctx.strokeStyle = isDecHover ? '#facc15' : '#475569';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, decX, ctrlY, decW, ctrlH, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('−', decX + 23, ctrlY + 36);

    this.hudButtons.push({
      id: 'haptic_dec',
      x: decX,
      y: ctrlY,
      width: decW,
      height: ctrlH,
      onClick: () => {
        const next = Math.max(0, Math.round((hapticStrength - 0.1) * 100) / 100);
        this.onChangeHapticStrengthFromHud?.(next);
      }
    });

    // Интерактивная дорожка слайдера (Haptic Strength Slider Track)
    const trackX = decX + decW + 16;
    const trackW = 596;
    const isTrackHover = this.hoveredButtonId === 'haptic_slider_track';

    ctx.fillStyle = isTrackHover ? 'rgba(30, 41, 59, 0.95)' : 'rgba(9, 13, 22, 0.9)';
    this.fillRoundedRect(ctx, trackX, ctrlY, trackW, ctrlH, 12);
    ctx.strokeStyle = isTrackHover ? '#facc15' : '#334155';
    ctx.lineWidth = isTrackHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, trackX, ctrlY, trackW, ctrlH, 12);

    // Внутренняя полоса ползунка
    const barPadX = 24;
    const barX = trackX + barPadX;
    const barW = trackW - barPadX * 2;
    const barY = ctrlY + 16;
    const barH = 14;

    ctx.fillStyle = '#1e293b';
    this.fillRoundedRect(ctx, barX, barY, barW, barH, 7);

    // Заполнение установленного уровня силы виброотклика (0..100%)
    const fillW = Math.max(0, Math.min(barW, barW * hapticStrength));
    if (fillW > 2) {
      const grad = ctx.createLinearGradient(barX, 0, barX + barW, 0);
      grad.addColorStop(0, '#38bdf8');
      grad.addColorStop(0.6, '#eab308');
      grad.addColorStop(1, '#ef4444');
      ctx.fillStyle = grad;
      this.fillRoundedRect(ctx, barX, barY, fillW, barH, 7);
    }

    // Индикатор мгновенной отдачи пропорционально текущему dD/dt поверх дорожки
    const liveW = Math.max(0, Math.min(barW, barW * effectiveHaptic));
    if (liveW > 2) {
      ctx.fillStyle = isDanger ? 'rgba(239, 68, 68, 0.85)' : 'rgba(52, 211, 153, 0.85)';
      this.fillRoundedRect(ctx, barX, barY + barH + 5, liveW, 5, 2.5);
    }

    // Деления шкалы 0%, 25%, 50%, 75%, 100%
    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    [0, 0.25, 0.5, 0.75, 1.0].forEach(tick => {
      const tx = barX + barW * tick;
      ctx.fillText(`${Math.round(tick * 100)}%`, tx - 10, ctrlY + 49);
    });

    // Бегунок (Thumb) слайдера
    const thumbX = barX + fillW;
    const thumbY = barY + barH / 2;
    ctx.beginPath();
    ctx.arc(thumbX, thumbY, 12, 0, Math.PI * 2);
    ctx.fillStyle = isTrackHover ? '#fef08a' : '#f8fafc';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#0284c7';
    ctx.stroke();

    this.hudButtons.push({
      id: 'haptic_slider_track',
      x: trackX,
      y: ctrlY,
      width: trackW,
      height: ctrlH,
      onClick: (_normX, px) => {
        if (px !== undefined) {
          const ratio = Math.max(0, Math.min(1, (px - barX) / barW));
          const rounded = Math.round(ratio * 20) / 20; // шаг 5% при клике/перетаскивании
          this.onChangeHapticStrengthFromHud?.(rounded);
        }
      }
    });

    // Кнопка [+] увеличения силы виброотклика
    const incX = trackX + trackW + 16;
    const incW = 64;
    const isIncHover = this.hoveredButtonId === 'haptic_inc';
    ctx.fillStyle = isIncHover ? '#334155' : '#1e293b';
    this.fillRoundedRect(ctx, incX, ctrlY, incW, ctrlH, 12);
    ctx.strokeStyle = isIncHover ? '#facc15' : '#475569';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, incX, ctrlY, incW, ctrlH, 12);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 28px monospace';
    ctx.fillText('+', incX + 23, ctrlY + 36);

    this.hudButtons.push({
      id: 'haptic_inc',
      x: incX,
      y: ctrlY,
      width: incW,
      height: ctrlH,
      onClick: () => {
        const next = Math.min(1, Math.round((hapticStrength + 0.1) * 100) / 100);
        this.onChangeHapticStrengthFromHud?.(next);
      }
    });

    // Кнопка быстрого переключения режима виброотклика (ВЫКЛ / 50% / 100%)
    const presetX = incX + incW + 16;
    const presetW = 146;
    const isPresetHover = this.hoveredButtonId === 'haptic_preset';
    ctx.fillStyle = isPresetHover
      ? '#334155'
      : hapticStrength > 0
      ? 'rgba(14, 116, 144, 0.35)'
      : '#1e293b';
    this.fillRoundedRect(ctx, presetX, ctrlY, presetW, ctrlH, 12);
    ctx.strokeStyle = isPresetHover ? '#facc15' : hapticStrength > 0 ? '#38bdf8' : '#64748b';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, presetX, ctrlY, presetW, ctrlH, 12);

    ctx.fillStyle = hapticStrength > 0 ? '#38bdf8' : '#94a3b8';
    ctx.font = 'bold 15px sans-serif';
    ctx.fillText(
      hapticStrength === 0 ? '🔇 ВЫКЛ (0%)' : `📳 РЕЖИМ ${strengthPct}%`,
      presetX + 14,
      ctrlY + 24
    );
    ctx.fillStyle = '#cbd5e1';
    ctx.font = '12px monospace';
    ctx.fillText('Клик: 0/50/100%', presetX + 14, ctrlY + 44);

    this.hudButtons.push({
      id: 'haptic_preset',
      x: presetX,
      y: ctrlY,
      width: presetW,
      height: ctrlH,
      onClick: () => {
        const next = hapticStrength >= 0.95 ? 0.0 : hapticStrength < 0.45 ? 0.5 : 1.0;
        this.onChangeHapticStrengthFromHud?.(next);
      }
    });

    // 5. Подвал с подсказками управления и строкой голосового протокола VoiceTaskLogger
    const isVoiceRec = Boolean(state.isVoicePushToTalkActive);
    const voiceVol = state.voiceVolumeLevel ?? 0;
    ctx.fillStyle = isVoiceRec ? '#4ade80' : '#94a3b8';
    ctx.font = 'bold 14px sans-serif';
    ctx.fillText(
      isVoiceRec
        ? `🎙 ЗАПИСЬ РЕЧИ (ru-RU): ${state.latestVoiceNoteText || 'Говорите команду или замер дозы...'}`
        : `🎙 Голосовой логгер [Удерживайте Y / Стик лев. контроллера]: ${
            state.latestVoiceNoteText
              ? `«${state.latestVoiceNoteText.slice(0, 52)}»`
              : 'протокол замеров + голосовые команды'
          }`,
      36,
      398
    );

    // 6. Интерактивные VR-кнопки быстрого доступа (Фонарь, Задачи, PTT, ГОСТ, ALARA)
    const btnY = 418;
    const btnH = 126;
    const btnW = 180;

    // --- Кнопка 1: Вкл/Выкл тактический фонарь ---
    const flashX = 24;
    const isFlashHover = this.hoveredButtonId === 'toggle_flashlight';
    const isFlashOn = Boolean(state.isFlashlightOn);
    ctx.fillStyle = isFlashHover
      ? '#1e293b'
      : isFlashOn
      ? 'rgba(234, 179, 8, 0.22)'
      : '#0f172a';
    this.fillRoundedRect(ctx, flashX, btnY, btnW, btnH, 16);
    ctx.strokeStyle = isFlashHover ? '#facc15' : isFlashOn ? '#fde047' : '#38bdf8';
    ctx.lineWidth = isFlashHover || isFlashOn ? 4 : 2;
    this.strokeRoundedRect(ctx, flashX, btnY, btnW, btnH, 16);

    ctx.fillStyle = isFlashHover || isFlashOn ? '#fde047' : '#38bdf8';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(isFlashOn ? '🔦 ФОНАРЬ: ВКЛ' : '🔦 ФОНАРЬ: ВЫКЛ', flashX + 12, btnY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('ФПС-4ВЗГ 5500K', flashX + 12, btnY + 70);

    ctx.fillStyle = isFlashOn ? '#4ade80' : '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('[X/A] или луч', flashX + 12, btnY + 100);

    this.hudButtons.push({
      id: 'toggle_flashlight',
      x: flashX,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => {
        this.onToggleFlashlightFromHud?.();
      }
    });

    // --- Кнопка 2: Чек-лист задач сценария ---
    const checkX = 219;
    const isCheckHover = this.hoveredButtonId === 'open_checklist';
    ctx.fillStyle = isCheckHover ? '#1e293b' : '#0f172a';
    this.fillRoundedRect(ctx, checkX, btnY, btnW, btnH, 16);
    ctx.strokeStyle = isCheckHover ? '#facc15' : '#06b6d4';
    ctx.lineWidth = isCheckHover ? 4 : 2;
    this.strokeRoundedRect(ctx, checkX, btnY, btnW, btnH, 16);

    ctx.fillStyle = isCheckHover ? '#facc15' : '#22d3ee';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('📋 ЗАДАЧИ', checkX + 12, btnY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('Чек-лист этапов', checkX + 12, btnY + 70);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('Регламент миссии', checkX + 12, btnY + 100);

    this.hudButtons.push({
      id: 'open_checklist',
      x: checkX,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => {
        this.onOpenChecklistFromHud?.();
      }
    });

    // --- Кнопка 3: Голосовой протокол и команды Push-to-Talk ---
    const voiceX = 414;
    const isVoiceHover = this.hoveredButtonId === 'toggle_voice_ptt';
    ctx.fillStyle = isVoiceHover
      ? '#1e293b'
      : isVoiceRec
      ? 'rgba(22, 163, 74, 0.28)'
      : '#0f172a';
    this.fillRoundedRect(ctx, voiceX, btnY, btnW, btnH, 16);
    ctx.strokeStyle = isVoiceHover ? '#facc15' : isVoiceRec ? '#4ade80' : '#10b981';
    ctx.lineWidth = isVoiceHover || isVoiceRec ? 4 : 2;
    this.strokeRoundedRect(ctx, voiceX, btnY, btnW, btnH, 16);

    const pulseRadius = 7 + (isVoiceRec ? voiceVol * 5 : 0);
    ctx.fillStyle = isVoiceRec ? '#4ade80' : '#10b981';
    ctx.beginPath();
    ctx.arc(voiceX + btnW - 18, btnY + 28, pulseRadius, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = isVoiceHover || isVoiceRec ? '#4ade80' : '#34d399';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(isVoiceRec ? '🎙 ЗАПИСЬ' : '🎙 ГОЛОС PTT', voiceX + 12, btnY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText(`Лог: ${state.voiceLogCount ?? 0} зап.`, voiceX + 12, btnY + 70);

    ctx.fillStyle = isVoiceRec ? '#fef08a' : '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('Удерж. [Y/Стик]', voiceX + 12, btnY + 100);

    this.hudButtons.push({
      id: 'toggle_voice_ptt',
      x: voiceX,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => {
        this.onToggleVoicePttFromHud?.();
      }
    });

    // --- Кнопка 4: Справочник ГОСТ ---
    const gostX = 609;
    const isGostHover = this.hoveredButtonId === 'open_gost';
    ctx.fillStyle = isGostHover ? '#1e293b' : '#0f172a';
    this.fillRoundedRect(ctx, gostX, btnY, btnW, btnH, 16);
    ctx.strokeStyle = isGostHover ? '#facc15' : '#38bdf8';
    ctx.lineWidth = isGostHover ? 4 : 2;
    this.strokeRoundedRect(ctx, gostX, btnY, btnW, btnH, 16);

    ctx.fillStyle = isGostHover ? '#facc15' : '#38bdf8';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('📖 ГОСТ 27451', gostX + 12, btnY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('Приборы и формулы', gostX + 12, btnY + 70);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('База детекторов', gostX + 12, btnY + 100);

    this.hudButtons.push({
      id: 'open_gost',
      x: gostX,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => {
        this.onOpenGostFromHud?.();
      }
    });

    // --- Кнопка 5: Отчет ALARA ---
    const alaraX = 804;
    const alaraW = 196;
    const isAlaraHover = this.hoveredButtonId === 'open_alara';
    ctx.fillStyle = isAlaraHover ? '#1e293b' : '#0f172a';
    this.fillRoundedRect(ctx, alaraX, btnY, alaraW, btnH, 16);
    ctx.strokeStyle = isAlaraHover ? '#facc15' : '#f59e0b';
    ctx.lineWidth = isAlaraHover ? 4 : 2;
    this.strokeRoundedRect(ctx, alaraX, btnY, alaraW, btnH, 16);

    ctx.fillStyle = isAlaraHover ? '#facc15' : '#fbbf24';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText('🏆 ОТЧЕТ ALARA', alaraX + 12, btnY + 38);

    ctx.fillStyle = '#cbd5e1';
    ctx.font = '13px sans-serif';
    ctx.fillText('График D(t) и итоги', alaraX + 12, btnY + 70);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '11px monospace';
    ctx.fillText('Протокол смены', alaraX + 12, btnY + 100);

    this.hudButtons.push({
      id: 'open_alara',
      x: alaraX,
      y: btnY,
      width: alaraW,
      height: btnH,
      onClick: () => {
        this.onOpenAlaraFromHud?.();
      }
    });

    this.hudTexture.needsUpdate = true;
  }

  // =========================================================================
  // Показ и очистка VR Toast
  // =========================================================================
  public clearToast(): void {
    this.currentToast = null;
    this.toastTimer = 0;
    this.toastMesh.visible = false;
  }

  public showToast(type: string, title: string, message: string): void {
    this.currentToast = { type, title, message };
    this.toastTimer = 5.0; // 5 секунд

    const ctx = this.toastCtx;
    const w = this.toastCanvas.width;
    const h = this.toastCanvas.height;

    ctx.clearRect(0, 0, w, h);

    const bgColor = type === 'danger' ? 'rgba(69, 10, 10, 0.95)' : type === 'warning' ? 'rgba(69, 39, 10, 0.95)' : 'rgba(15, 23, 42, 0.95)';
    const borderColor = type === 'danger' ? '#ef4444' : type === 'warning' ? '#f59e0b' : '#38bdf8';

    ctx.fillStyle = bgColor;
    this.fillRoundedRect(ctx, 6, 6, w - 12, h - 12, 16);

    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 3;
    this.strokeRoundedRect(ctx, 6, 6, w - 12, h - 12, 16);

    ctx.fillStyle = borderColor;
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText(`⚡ ${title}`, 26, 48);

    ctx.fillStyle = '#f8fafc';
    ctx.font = '20px sans-serif';
    const cleanMsg = message.length > 70 ? message.slice(0, 68) + '...' : message;
    ctx.fillText(cleanMsg, 26, 92);

    this.toastTexture.needsUpdate = true;
    this.toastMesh.visible = true;
  }

  // =========================================================================
  // VR GOST Instruments Modal
  // =========================================================================
  public openGostModal(
    currentId: InstrumentId,
    onSelect: (id: InstrumentId) => void,
    onClose: () => void
  ): void {
    this.isGostModalOpen = true;
    this.gostModalGroup.visible = true;
    this.hudMesh.visible = false; // Скрываем HUD, чтобы избежать визуального наложения
    this.onSelectInstrumentCb = onSelect;
    this.onCloseGostCb = onClose;
    this.renderGostModal(currentId);
  }

  public closeGostModal(): void {
    this.isGostModalOpen = false;
    this.gostModalGroup.visible = false;
    this.hudMesh.visible = true; // Восстанавливаем видимость HUD
    this.onCloseGostCb();
  }

  public closeModals(): void {
    if (this.isSuccessModalOpen) {
      this.closeSuccessModal();
    }
    if (this.isChecklistModalOpen) {
      this.closeChecklistModal();
    }
    if (this.isGostModalOpen) {
      this.closeGostModal();
    }
    if (this.isReportModalOpen) {
      this.closeReportModal();
    }
  }

  private renderGostModal(selectedId: InstrumentId): void {
    const ctx = this.gostCtx;
    const w = this.gostCanvas.width;
    const h = this.gostCanvas.height;
    this.gostButtons = [];

    ctx.clearRect(0, 0, w, h);

    // Фон панели
    ctx.fillStyle = 'rgba(15, 23, 42, 0.97)';
    this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 3;
    this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // Заголовок
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('📖 Справочник средств измерений по ГОСТ 27451-87', 36, 56);

    // Кнопка закрытия [ ✕ ]
    const closeBtnX = w - 80;
    const closeBtnY = 24;
    ctx.fillStyle = '#ef4444';
    this.fillRoundedRect(ctx, closeBtnX, closeBtnY, 50, 44, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('✕', closeBtnX + 16, closeBtnY + 31);
    this.gostButtons.push({
      id: 'gost_close',
      x: closeBtnX,
      y: closeBtnY,
      width: 50,
      height: 44,
      onClick: () => this.closeGostModal()
    });

    // Вкладки (Tabs)
    const tabs: { id: VRGostTabType; label: string }[] = [
      { id: 'all', label: 'Все приборы' },
      { id: 'dp5', label: '1. МКС (Гейгер)' },
      { id: 'ion', label: '2. Ионизационная' },
      { id: 'nai', label: '3. NaI(Tl) Сцинтилл.' },
      { id: 'neutron', label: '4. Нейтронный' },
      { id: 'formulas', label: 'Формулы ГОСТ' }
    ];

    let tabX = 36;
    const tabY = 80;
    tabs.forEach(tab => {
      const isSel = this.gostActiveTab === tab.id;
      const tabWidth = 175;
      ctx.fillStyle = isSel ? '#eab308' : '#1e293b';
      this.fillRoundedRect(ctx, tabX, tabY, tabWidth, 38, 8);

      ctx.fillStyle = isSel ? '#000000' : '#cbd5e1';
      ctx.font = 'bold 15px sans-serif';
      ctx.fillText(tab.label, tabX + 12, tabY + 24);

      const tabIdVal = tab.id;
      this.gostButtons.push({
        id: `tab_${tabIdVal}`,
        x: tabX,
        y: tabY,
        width: tabWidth,
        height: 38,
        onClick: () => {
          this.gostActiveTab = tabIdVal;
          this.renderGostModal(selectedId);
        }
      });

      tabX += tabWidth + 12;
    });

    // Контент вкладки
    if (this.gostActiveTab === 'formulas') {
      this.renderGostFormulasTab(ctx, w, h);
    } else {
      const instruments: InstrumentProfile[] = this.gostActiveTab === 'all'
        ? Object.values(GOST_INSTRUMENTS)
        : [GOST_INSTRUMENTS[this.gostActiveTab]];

      let cardY = 140;
      instruments.forEach(inst => {
        const isCurrent = inst.id === selectedId;
        ctx.fillStyle = isCurrent ? 'rgba(30, 41, 59, 0.95)' : 'rgba(20, 27, 45, 0.85)';
        this.fillRoundedRect(ctx, 36, cardY, w - 72, 140, 14);

        ctx.strokeStyle = isCurrent ? '#22c55e' : '#334155';
        ctx.lineWidth = isCurrent ? 2.5 : 1;
        this.strokeRoundedRect(ctx, 36, cardY, w - 72, 140, 14);

        // Название прибора
        ctx.fillStyle = '#f8fafc';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(inst.name, 56, cardY + 34);

        ctx.fillStyle = '#94a3b8';
        ctx.font = '15px sans-serif';
        ctx.fillText(`Детектор: ${inst.detectorTypeRu}`, 56, cardY + 62);
        ctx.fillText(`Диапазон: ${inst.measurementRangeRu}  •  Погрешность: ±${inst.basicErrorPercent}%`, 56, cardY + 88);
        ctx.fillText(`Назначение: ${inst.applicationRu.slice(0, 85)}...`, 56, cardY + 114);

        // Кнопка [ ВЫБРАТЬ ]
        const btnW = 160;
        const btnH = 46;
        const btnX = w - 36 - btnW - 20;
        const btnY = cardY + 45;

        ctx.fillStyle = isCurrent ? '#166534' : '#eab308';
        this.fillRoundedRect(ctx, btnX, btnY, btnW, btnH, 10);

        ctx.fillStyle = isCurrent ? '#86efac' : '#000000';
        ctx.font = 'bold 16px sans-serif';
        const btnLabel = isCurrent ? '✓ АКТИВЕН' : 'ВЫБРАТЬ';
        ctx.fillText(btnLabel, btnX + 32, btnY + 28);

        const instId = inst.id;
        this.gostButtons.push({
          id: `select_${instId}`,
          x: btnX,
          y: btnY,
          width: btnW,
          height: btnH,
          onClick: () => {
            this.onSelectInstrumentCb(instId);
            this.closeGostModal();
          }
        });

        cardY += 156;
      });
    }

    this.gostTexture.needsUpdate = true;
  }

  private renderGostFormulasTab(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('Метрологические формулы и законы физики защиты', 56, 160);

    const formulas = [
      {
        title: '1. Мощность дозы точечного источника гамма-излучения:',
        eq: 'H = (Γ_δ · A) / r²   (мкЗв/ч)',
        desc: 'где Γ_δ — гамма-постоянная изотопа, A — активность (МБк), r — расстояние (м).'
      },
      {
        title: '2. Ослабление излучения защитным экраном (Закон Тейлора):',
        eq: 'I = I_0 · B(E, μd) · exp(-μ · d)',
        desc: 'где μ — линейный коэффициент ослабления, d — толщина защиты (см), B — фактор накопления рассеянных квантов.'
      },
      {
        title: '3. Принцип ALARA (As Low As Reasonably Achievable):',
        eq: 'D = ∫ H(t) dt → min  через оптимизацию Времени, Расстояния и Экранирования.',
        desc: 'Регламентировано Нормами радиационной безопасности НРБ-99/2009 и ОСПОРБ-99/2010.'
      }
    ];

    let y = 200;
    formulas.forEach(f => {
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 18px sans-serif';
      ctx.fillText(f.title, 56, y);

      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 22px monospace';
      ctx.fillText(f.eq, 56, y + 32);

      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px sans-serif';
      ctx.fillText(f.desc, 56, y + 60);

      y += 94;
    });
  }

  // =========================================================================
  // VR ALARA Report Modal
  // =========================================================================
  public openReportModal(
    cumulativeDoseMsv: number,
    missionTimeSec: number,
    chartLabels: string[],
    chartDoseRate: number[],
    scenarioTitle: string,
    onRestart: () => void,
    onClose: () => void
  ): void {
    this.isReportModalOpen = true;
    this.reportModalGroup.visible = true;
    this.hudMesh.visible = false; // Скрываем HUD, чтобы избежать визуального наложения
    this.onRestartMissionCb = onRestart;
    this.onCloseReportCb = onClose;

    this.renderReportChart(chartLabels, chartDoseRate);
    this.renderReportModal(cumulativeDoseMsv, missionTimeSec, scenarioTitle);
  }

  public closeReportModal(): void {
    this.isReportModalOpen = false;
    this.reportModalGroup.visible = false;
    this.hudMesh.visible = true; // Восстанавливаем видимость HUD
    this.onCloseReportCb();
  }

  private renderReportChart(labels: string[], data: number[]): void {
    if (this.offscreenChartInstance) {
      this.offscreenChartInstance.destroy();
      this.offscreenChartInstance = null;
    }

    try {
      this.offscreenChartInstance = new ChartJS(this.offscreenChartCanvas, {
        type: 'line',
        data: {
          labels: labels.length > 0 ? labels : ['0с'],
          datasets: [
            {
              label: 'Мощность дозы (мкЗв/ч)',
              data: data.length > 0 ? data : [0],
              borderColor: '#eab308',
              backgroundColor: 'rgba(234, 179, 8, 0.25)',
              fill: true,
              tension: 0.3,
              borderWidth: 3
            }
          ]
        },
        options: {
          animation: false,
          responsive: false,
          maintainAspectRatio: false,
          scales: {
            x: {
              ticks: { color: '#94a3b8', font: { size: 12 } },
              grid: { color: 'rgba(255, 255, 255, 0.08)' }
            },
            y: {
              ticks: { color: '#94a3b8', font: { size: 12 } },
              grid: { color: 'rgba(255, 255, 255, 0.08)' }
            }
          },
          plugins: {
            legend: { labels: { color: '#ffffff', font: { size: 14, weight: 'bold' } } }
          }
        }
      });
    } catch (e) {
      console.error('Error rendering VR ChartJS:', e);
    }
  }

  private renderReportModal(
    cumulativeDoseMsv: number,
    missionTimeSec: number,
    scenarioTitle: string
  ): void {
    const ctx = this.reportCtx;
    const w = this.reportCanvas.width;
    const h = this.reportCanvas.height;
    this.reportButtons = [];

    ctx.clearRect(0, 0, w, h);

    // Фоновая панель
    ctx.fillStyle = 'rgba(15, 23, 42, 0.97)';
    this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    ctx.strokeStyle = '#eab308';
    ctx.lineWidth = 3;
    this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // Заголовок
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('🏆 Анализ ALARA & Протокол Радиационной Безопасности', 36, 56);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '17px sans-serif';
    ctx.fillText(scenarioTitle, 36, 84);

    // Кнопка закрытия [ ✕ ]
    const closeBtnX = w - 80;
    const closeBtnY = 24;
    ctx.fillStyle = '#ef4444';
    this.fillRoundedRect(ctx, closeBtnX, closeBtnY, 50, 44, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('✕', closeBtnX + 16, closeBtnY + 31);
    this.reportButtons.push({
      id: 'report_close',
      x: closeBtnX,
      y: closeBtnY,
      width: 50,
      height: 44,
      onClick: () => this.closeReportModal()
    });

    // Расчет оценки ALARA
    let grade = 'ОТЛИЧНО (A)';
    let gradeColor = '#22c55e';
    if (cumulativeDoseMsv > 0.05) {
      grade = 'ПРЕВЫШЕНИЕ (F)';
      gradeColor = '#ef4444';
    } else if (cumulativeDoseMsv > 0.01) {
      grade = 'ХОРОШО (B)';
      gradeColor = '#f59e0b';
    }

    const mins = Math.floor(missionTimeSec / 60);
    const secs = Math.floor(missionTimeSec % 60);
    const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // 3 Карточки метрик
    const cardW = 350;
    const cardH = 100;

    // Карточка 1: Доза
    ctx.fillStyle = '#1e293b';
    this.fillRoundedRect(ctx, 36, 110, cardW, cardH, 14);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('СУММАРНАЯ ДОЗА:', 54, 136);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${cumulativeDoseMsv.toFixed(4)} мЗв`, 54, 180);

    // Карточка 2: Время
    ctx.fillStyle = '#1e293b';
    this.fillRoundedRect(ctx, 410, 110, cardW, cardH, 14);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('ВРЕМЯ В ЗОНЕ:', 428, 136);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(timeFormatted, 428, 180);

    // Карточка 3: Оценка
    ctx.fillStyle = '#1e293b';
    this.fillRoundedRect(ctx, 784, 110, cardW, cardH, 14);
    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('ОЦЕНКА ALARA:', 802, 136);
    ctx.fillStyle = gradeColor;
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(grade, 802, 180);

    // Вставка реального графика Chart.js
    ctx.fillStyle = '#0f172a';
    this.fillRoundedRect(ctx, 36, 230, w - 72, 260, 14);
    ctx.drawImage(this.offscreenChartCanvas, 46, 240, w - 92, 240);

    // Принципы ALARA блок
    ctx.fillStyle = 'rgba(30, 41, 59, 0.8)';
    this.fillRoundedRect(ctx, 36, 510, w - 72, 140, 14);

    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('⚖️ Оценка соблюдения трех принципов радиационной защиты ALARA:', 56, 538);

    ctx.fillStyle = '#e2e8f0';
    ctx.font = '16px sans-serif';
    ctx.fillText('1. ВРЕМЯ: минимизация хронометража операций в активной зоне снижает суммарную дозу прямо пропорционально.', 56, 570);
    ctx.fillText('2. РАССТОЯНИЕ: удаление от точечного источника снижает радиационный фон по закону обратных квадратов (1/r²).', 56, 598);
    ctx.fillText('3. ЭКРАНИРОВАНИЕ: своевременная установка свинцовых ширм поглощает гамма-кванты с учетом рассеяния.', 56, 626);

    // Кнопка [ Пройти миссию заново ]
    const btnW = 340;
    const btnH = 60;
    const btnY = 675;

    ctx.fillStyle = '#eab308';
    this.fillRoundedRect(ctx, 36, btnY, btnW, btnH, 14);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('🔄 Пройти миссию заново', 64, btnY + 38);
    this.reportButtons.push({
      id: 'restart_mission',
      x: 36,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => {
        this.closeReportModal();
        this.onRestartMissionCb();
      }
    });

    // Кнопка [ Продолжить ]
    const contBtnX = 400;
    ctx.fillStyle = '#334155';
    this.fillRoundedRect(ctx, contBtnX, btnY, btnW, btnH, 14);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('✓ Продолжить исследование', contBtnX + 28, btnY + 38);
    this.reportButtons.push({
      id: 'continue_mission',
      x: contBtnX,
      y: btnY,
      width: btnW,
      height: btnH,
      onClick: () => this.closeReportModal()
    });

    this.reportTexture.needsUpdate = true;
  }

  // =========================================================================
  // VR Success Modal (Окно успешного завершения сценария)
  // =========================================================================
  public openSuccessModal(
    data: VRSuccessModalData,
    onNext?: () => void,
    onRestart?: () => void,
    onOpenReport?: () => void,
    onClose?: () => void
  ): void {
    this.currentSuccessData = data;
    this.isSuccessModalOpen = true;
    this.successModalGroup.visible = true;
    this.hudMesh.visible = false; // Скрываем HUD, чтобы избежать визуального наложения
    if (onNext) this.onNextScenarioFromSuccess = onNext;
    if (onRestart) this.onRestartScenarioFromSuccess = onRestart;
    if (onOpenReport) this.onOpenReportFromSuccess = onOpenReport;
    if (onClose) this.onCloseSuccessCb = onClose;

    this.renderSuccessModal(data);
  }

  public closeSuccessModal(): void {
    this.isSuccessModalOpen = false;
    this.successModalGroup.visible = false;
    this.hudMesh.visible = this.isHudVisible;
    this.onCloseSuccessCb();
  }

  private renderSuccessModal(data: VRSuccessModalData): void {
    const ctx = this.successCtx;
    const w = this.successCanvas.width;
    const h = this.successCanvas.height;
    this.successButtons = [];

    ctx.clearRect(0, 0, w, h);

    // Фоновая панель с изумрудно-золотым градиентом границы
    ctx.fillStyle = 'rgba(10, 25, 20, 0.97)';
    this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 4;
    this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // Заголовок
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('🏆 СЦЕНАРИЙ УСПЕШНО ЗАВЕРШЕН! • ALARA SUCCESS', 36, 56);

    ctx.fillStyle = '#fef08a';
    ctx.font = 'bold 18px monospace';
    ctx.fillText(`Сценарий ${data.scenarioId}/4: ${data.scenarioTitle}`, 36, 88);

    // Кнопка закрытия [ ✕ ]
    const closeBtnX = w - 80;
    const closeBtnY = 24;
    const isCloseHover = this.hoveredButtonId === 'success_close';
    ctx.fillStyle = isCloseHover ? '#ef4444' : '#b91c1c';
    this.fillRoundedRect(ctx, closeBtnX, closeBtnY, 50, 44, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 26px sans-serif';
    ctx.fillText('✕', closeBtnX + 16, closeBtnY + 31);
    this.successButtons.push({
      id: 'success_close',
      x: closeBtnX,
      y: closeBtnY,
      width: 50,
      height: 44,
      onClick: () => this.closeSuccessModal()
    });

    // Расчет оценки ALARA
    let grade = data.alaraRating || 'ОТЛИЧНО (КЛАСС А)';
    let gradeColor = '#22c55e';
    if (data.cumulativeDoseMsv > (data.hLimitMsv * 0.8)) {
      grade = 'УДОВЛЕТВОРИТЕЛЬНО (КЛАСС C)';
      gradeColor = '#f59e0b';
    } else if (data.cumulativeDoseMsv > (data.hLimitMsv * 0.4)) {
      grade = 'ХОРОШО (КЛАСС B)';
      gradeColor = '#38bdf8';
    }

    const mins = Math.floor(data.missionTimeSec / 60);
    const secs = Math.floor(data.missionTimeSec % 60);
    const timeFormatted = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    // 4 Карточки метрик (2x2)
    const cardW = 548;
    const cardH = 110;

    // Карточка 1: Накопленная доза
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    this.fillRoundedRect(ctx, 36, 120, cardW, cardH, 14);
    ctx.strokeStyle = '#10b981';
    ctx.lineWidth = 1.5;
    this.strokeRoundedRect(ctx, 36, 120, cardW, cardH, 14);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('НАКОПЛЕННАЯ ЭКВИВАЛЕНТНАЯ ДОЗА:', 54, 148);
    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${data.cumulativeDoseMsv.toFixed(4)} мЗв`, 54, 196);
    ctx.fillStyle = '#6ee7b7';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`Лимит наряда-допуска: ${(data.hLimitMsv * 1000).toFixed(0)} мкЗв (Безопасно)`, 250, 196);

    // Карточка 2: Время в зоне
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    this.fillRoundedRect(ctx, 616, 120, cardW, cardH, 14);
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.5;
    this.strokeRoundedRect(ctx, 616, 120, cardW, cardH, 14);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('ХРОНОМЕТРАЖ ОПЕРАЦИИ (ЗАЩИТА ВРЕМЕНЕМ):', 634, 148);
    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(timeFormatted, 634, 196);
    ctx.fillStyle = '#93c5fd';
    ctx.font = 'bold 15px monospace';
    ctx.fillText(`Всего секунд: ${Math.round(data.missionTimeSec)}с`, 790, 196);

    // Карточка 3: Задачи
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    this.fillRoundedRect(ctx, 36, 250, cardW, cardH, 14);
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 1.5;
    this.strokeRoundedRect(ctx, 36, 250, cardW, cardH, 14);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('ВЫПОЛНЕНИЕ ЗАДАЧ СЦЕНАРИЯ:', 54, 278);
    ctx.fillStyle = '#facc15';
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText(`${data.completedTasksCount ?? 3} / ${data.totalTasksCount ?? 3} ЗАВЕРШЕНО`, 54, 326);

    // Карточка 4: Оценка ALARA
    ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
    this.fillRoundedRect(ctx, 616, 250, cardW, cardH, 14);
    ctx.strokeStyle = gradeColor;
    ctx.lineWidth = 1.5;
    this.strokeRoundedRect(ctx, 616, 250, cardW, cardH, 14);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '14px monospace';
    ctx.fillText('ИНТЕГРАЛЬНАЯ ОЦЕНКА ALARA:', 634, 278);
    ctx.fillStyle = gradeColor;
    ctx.font = 'bold 32px sans-serif';
    ctx.fillText(grade, 634, 326);

    // Блок регламента ОСПОРБ-99/2010 и ALARA
    ctx.fillStyle = 'rgba(16, 185, 129, 0.12)';
    this.fillRoundedRect(ctx, 36, 380, w - 72, 170, 16);
    ctx.strokeStyle = 'rgba(16, 185, 129, 0.4)';
    ctx.lineWidth = 2;
    this.strokeRoundedRect(ctx, 36, 380, w - 72, 170, 16);

    ctx.fillStyle = '#34d399';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('🛡️ Заключение по радиационной безопасности:', 56, 414);

    ctx.fillStyle = '#f0fdf4';
    ctx.font = '17px sans-serif';
    ctx.fillText('✓ Все радиоактивные источники локализованы, экранированы или перекрыты.', 56, 450);
    ctx.fillText('✓ Дозовая нагрузка оператора удержана в пределах безопасных нормативов НРБ-99/2009.', 56, 480);
    ctx.fillText('✓ СИЗ и дистанционный манипулятор применены в соответствии с технологической картой.', 56, 510);

    // Интерактивные 3D-кнопки внизу
    const btnY = 660;
    const btnH = 68;

    // Кнопка 1: [ ❯ СЛЕДУЮЩИЙ СЦЕНАРИЙ ]
    const nextBtnW = 340;
    const isNextHov = this.hoveredButtonId === 'success_next';
    ctx.fillStyle = isNextHov ? '#15803d' : '#16a34a';
    this.fillRoundedRect(ctx, 36, btnY, nextBtnW, btnH, 16);
    ctx.strokeStyle = isNextHov ? '#facc15' : '#4ade80';
    ctx.lineWidth = isNextHov ? 4 : 2;
    this.strokeRoundedRect(ctx, 36, btnY, nextBtnW, btnH, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText('❯ СЛЕДУЮЩИЙ СЦЕНАРИЙ', 60, btnY + 42);

    this.successButtons.push({
      id: 'success_next',
      x: 36,
      y: btnY,
      width: nextBtnW,
      height: btnH,
      onClick: () => {
        this.closeSuccessModal();
        this.onNextScenarioFromSuccess?.();
      }
    });

    // Кнопка 2: [ 🔄 ПОВТОРИТЬ СЦЕНАРИЙ ]
    const rstBtnX = 396;
    const rstBtnW = 280;
    const isRstHov = this.hoveredButtonId === 'success_restart';
    ctx.fillStyle = isRstHov ? '#b45309' : '#d97706';
    this.fillRoundedRect(ctx, rstBtnX, btnY, rstBtnW, btnH, 16);
    ctx.strokeStyle = isRstHov ? '#facc15' : '#fcd34d';
    ctx.lineWidth = isRstHov ? 4 : 2;
    this.strokeRoundedRect(ctx, rstBtnX, btnY, rstBtnW, btnH, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('🔄 ПОВТОРИТЬ СЦЕНАРИЙ', rstBtnX + 24, btnY + 42);

    this.successButtons.push({
      id: 'success_restart',
      x: rstBtnX,
      y: btnY,
      width: rstBtnW,
      height: btnH,
      onClick: () => {
        this.closeSuccessModal();
        this.onRestartScenarioFromSuccess?.();
      }
    });

    // Кнопка 3: [ 📊 ОТЧЕТ ALARA ]
    const repBtnX = 696;
    const repBtnW = 240;
    const isRepHov = this.hoveredButtonId === 'success_report';
    ctx.fillStyle = isRepHov ? '#1e40af' : '#2563eb';
    this.fillRoundedRect(ctx, repBtnX, btnY, repBtnW, btnH, 16);
    ctx.strokeStyle = isRepHov ? '#facc15' : '#60a5fa';
    ctx.lineWidth = isRepHov ? 4 : 2;
    this.strokeRoundedRect(ctx, repBtnX, btnY, repBtnW, btnH, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('📊 ОТЧЕТ ALARA', repBtnX + 32, btnY + 42);

    this.successButtons.push({
      id: 'success_report',
      x: repBtnX,
      y: btnY,
      width: repBtnW,
      height: btnH,
      onClick: () => {
        this.closeSuccessModal();
        this.onOpenReportFromSuccess?.();
      }
    });

    // Кнопка 4: [ ✓ ЗАКРЫТЬ ]
    const okBtnX = 956;
    const okBtnW = 208;
    const isOkHov = this.hoveredButtonId === 'success_continue';
    ctx.fillStyle = isOkHov ? '#334155' : '#1e293b';
    this.fillRoundedRect(ctx, okBtnX, btnY, okBtnW, btnH, 16);
    ctx.strokeStyle = isOkHov ? '#facc15' : '#64748b';
    ctx.lineWidth = isOkHov ? 4 : 2;
    this.strokeRoundedRect(ctx, okBtnX, btnY, okBtnW, btnH, 16);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('✓ ЗАКРЫТЬ', okBtnX + 44, btnY + 42);

    this.successButtons.push({
      id: 'success_continue',
      x: okBtnX,
      y: btnY,
      width: okBtnW,
      height: btnH,
      onClick: () => this.closeSuccessModal()
    });

    this.successTexture.needsUpdate = true;
  }

  // =========================================================================
  // VR Checklist Modal (Чек-лист задач сценария в 3D — Multi-step Task Engine)
  // =========================================================================
  private lastChecklistStep = 0;
  private lastChecklistStages: Array<{ stepNumber: number; titleRu: string; taskRu: string; hintRu?: string; alaraRuleRu?: string }> = [];
  private lastChecklistHasError = false;

  public openChecklistModal(
    currentStep: number,
    stages: Array<{ stepNumber: number; titleRu: string; taskRu: string; hintRu?: string; alaraRuleRu?: string }>,
    hasError = false
  ): void {
    this.isChecklistModalOpen = true;
    this.checklistModalGroup.visible = true;
    this.hudMesh.visible = false; // Скрываем основной планшет, чтобы избежать наложения
    this.lastChecklistStep = currentStep;
    this.lastChecklistStages = stages;
    this.lastChecklistHasError = hasError;
    this.renderChecklistModal(currentStep, stages, hasError);
  }

  public updateChecklistLive(
    currentStep: number,
    stages: Array<{ stepNumber: number; titleRu: string; taskRu: string; hintRu?: string; alaraRuleRu?: string }>,
    hasError = false
  ): void {
    if (!this.isChecklistModalOpen) return;
    if (
      this.lastChecklistStep === currentStep &&
      this.lastChecklistHasError === hasError &&
      this.lastChecklistStages.length === stages.length
    ) {
      return;
    }
    this.lastChecklistStep = currentStep;
    this.lastChecklistStages = stages;
    this.lastChecklistHasError = hasError;
    this.renderChecklistModal(currentStep, stages, hasError);
  }

  public closeChecklistModal(): void {
    this.isChecklistModalOpen = false;
    this.checklistModalGroup.visible = false;
    this.hudMesh.visible = this.isHudVisible;
  }

  private renderChecklistModal(
    currentStep: number,
    stages: Array<{ stepNumber: number; titleRu: string; taskRu: string; hintRu?: string; alaraRuleRu?: string }>,
    hasError = false
  ): void {
    const ctx = this.checklistCtx;
    const w = this.checklistCanvas.width;
    const h = this.checklistCanvas.height;
    this.checklistButtons = [];

    ctx.clearRect(0, 0, w, h);

    // Фоновая панель с бирюзовой каймой
    ctx.fillStyle = 'rgba(10, 20, 30, 0.98)';
    this.fillRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    ctx.strokeStyle = hasError ? '#ef4444' : '#06b6d4';
    ctx.lineWidth = 3.5;
    this.strokeRoundedRect(ctx, 10, 10, w - 20, h - 20, 24);

    // Заголовок
    ctx.fillStyle = hasError ? '#f87171' : '#22d3ee';
    ctx.font = 'bold 28px sans-serif';
    ctx.fillText('📋 ЧЕК-ЛИСТ ЗАДАЧ СЦЕНАРИЯ • РЕГЛАМЕНТ РХБЗ & ALARA', 36, 52);

    // Кнопка закрытия [ ✕ ]
    const closeBtnX = w - 76;
    const closeBtnY = 20;
    const isCloseHover = this.hoveredButtonId === 'checklist_close';
    ctx.fillStyle = isCloseHover ? '#ef4444' : '#991b1b';
    this.fillRoundedRect(ctx, closeBtnX, closeBtnY, 52, 42, 10);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText('✕', closeBtnX + 17, closeBtnY + 29);
    this.checklistButtons.push({
      id: 'checklist_close',
      x: closeBtnX,
      y: closeBtnY,
      width: 52,
      height: 42,
      onClick: () => this.closeChecklistModal()
    });

    // Прогресс выполнения
    const totalCount = Math.max(1, stages.length);
    const progressPct = Math.min(100, Math.round((currentStep / totalCount) * 100));
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 15px monospace';
    const statusSummary = hasError
      ? 'ВНИМАНИЕ: ЗАФИКСИРОВАНО НАРУШЕНИЕ РЕЖИМА БЕЗОПАСНОСТИ'
      : `ПРОГРЕСС ИССЛЕДОВАНИЯ: ${progressPct}% (Шаг ${Math.min(totalCount, currentStep + 1)} из ${totalCount})`;
    ctx.fillText(statusSummary, 36, 82);

    // Прогресс-бар
    const barX = 36;
    const barY = 92;
    const barW = w - 72;
    const barH = 10;
    ctx.fillStyle = '#1e293b';
    this.fillRoundedRect(ctx, barX, barY, barW, barH, 5);
    ctx.fillStyle = hasError ? '#ef4444' : '#06b6d4';
    this.fillRoundedRect(ctx, barX, barY, Math.min(barW, Math.max(8, (barW * progressPct) / 100)), barH, 5);

    // =========================================================================
    // Сетка карточек этапов: 2 колонки x до 4 строк = 8 микро-задач
    // =========================================================================
    const cols = 2;
    const colWidth = Math.floor((w - 72 - 16) / cols); // ~548 px
    const rowHeight = 126;
    const rowGap = 10;
    const gridStartY = 114;

    stages.slice(0, 8).forEach((stage, idx) => {
      const col = idx % cols;
      const row = Math.floor(idx / cols);
      const cardX = barX + col * (colWidth + 16);
      const cardY = gridStartY + row * (rowHeight + rowGap);

      const isCompleted = idx < currentStep;
      const isCurrent = idx === currentStep;
      const isFailed = isCurrent && hasError;

      // Фон карточки
      ctx.fillStyle = isFailed
        ? 'rgba(127, 29, 29, 0.45)'
        : isCurrent
        ? 'rgba(6, 78, 99, 0.45)'
        : isCompleted
        ? 'rgba(15, 40, 30, 0.55)'
        : 'rgba(15, 23, 42, 0.55)';
      this.fillRoundedRect(ctx, cardX, cardY, colWidth, rowHeight, 10);

      // Рамка карточки
      ctx.strokeStyle = isFailed
        ? '#ef4444'
        : isCurrent
        ? '#06b6d4'
        : isCompleted
        ? '#10b981'
        : '#334155';
      ctx.lineWidth = isCurrent || isFailed ? 2.5 : 1.2;
      this.strokeRoundedRect(ctx, cardX, cardY, colWidth, rowHeight, 10);

      // 1. Статус этапа
      if (isCompleted) {
        ctx.fillStyle = '#34d399';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(`✓ [ВЫПОЛНЕНО] Шаг ${idx + 1}`, cardX + 12, cardY + 24);
      } else if (isFailed) {
        ctx.fillStyle = '#f87171';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(`✖ [ОШИБКА] Шаг ${idx + 1}`, cardX + 12, cardY + 24);
      } else if (isCurrent) {
        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(`▶ [В ПРОЦЕССЕ] Шаг ${idx + 1}`, cardX + 12, cardY + 24);
      } else {
        ctx.fillStyle = '#64748b';
        ctx.font = 'bold 15px monospace';
        ctx.fillText(`○ [ОЖИДАЕТ] Шаг ${idx + 1}`, cardX + 12, cardY + 24);
      }

      // Кнопка быстрого подтверждения выполнения текущего шага в VR
      if (isCurrent) {
        const checkBtnW = 145;
        const checkBtnH = 28;
        const checkBtnX = cardX + colWidth - checkBtnW - 10;
        const checkBtnY = cardY + 8;
        const isBtnHover = this.hoveredButtonId === `step_check_${idx}`;

        ctx.fillStyle = isBtnHover ? '#0284c7' : '#0369a1';
        this.fillRoundedRect(ctx, checkBtnX, checkBtnY, checkBtnW, checkBtnH, 6);
        ctx.strokeStyle = isBtnHover ? '#facc15' : '#38bdf8';
        ctx.lineWidth = 1.5;
        this.strokeRoundedRect(ctx, checkBtnX, checkBtnY, checkBtnW, checkBtnH, 6);

        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 13px sans-serif';
        ctx.fillText('✓ ОТМЕТИТЬ', checkBtnX + 22, checkBtnY + 19);

        this.checklistButtons.push({
          id: `step_check_${idx}`,
          x: checkBtnX,
          y: checkBtnY,
          width: checkBtnW,
          height: checkBtnH,
          onClick: () => {
            this.onAdvanceStepFromHud?.(idx + 1);
          }
        });
      }

      // 2. Название этапа
      ctx.fillStyle = isCurrent ? '#f8fafc' : isCompleted ? '#cbd5e1' : '#94a3b8';
      ctx.font = 'bold 14px sans-serif';
      const cleanTitle = stage.titleRu.length > 46 ? stage.titleRu.slice(0, 44) + '...' : stage.titleRu;
      ctx.fillText(cleanTitle, cardX + 12, cardY + 48);

      // 3. Текст задачи
      ctx.fillStyle = isCurrent ? '#e2e8f0' : '#64748b';
      ctx.font = '13px sans-serif';
      const cleanTask = stage.taskRu.length > 60 ? stage.taskRu.slice(0, 58) + '...' : stage.taskRu;
      ctx.fillText(cleanTask, cardX + 12, cardY + 74);

      // 4. Подсказка / Регламент
      if (stage.hintRu || stage.alaraRuleRu) {
        const hintText = stage.hintRu || stage.alaraRuleRu || '';
        ctx.fillStyle = isCurrent ? '#fde047' : '#64748b';
        ctx.font = '12px monospace';
        const cleanHint = hintText.length > 58 ? hintText.slice(0, 56) + '...' : hintText;
        ctx.fillText(`💡 ${cleanHint}`, cardX + 12, cardY + 102);
      }
    });

    // =========================================================================
    // Нижняя панель действий: [ ✓ ПРИСТУПИТЬ / ЗАКРЫТЬ ] и [ ⏩ СЛЕДУЮЩИЙ ШАГ ]
    // =========================================================================
    const bottomBarY = 672;
    const btnH = 58;

    // Кнопка 1: Приступить к выполнению / Закрыть чек-лист
    const btn1W = 380;
    const isActHover = this.hoveredButtonId === 'checklist_action';
    ctx.fillStyle = isActHover ? '#0891b2' : '#06b6d4';
    this.fillRoundedRect(ctx, 36, bottomBarY, btn1W, btnH, 12);
    ctx.strokeStyle = isActHover ? '#facc15' : '#67e8f9';
    ctx.lineWidth = isActHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, 36, bottomBarY, btn1W, btnH, 12);
    ctx.fillStyle = '#000000';
    ctx.font = 'bold 20px sans-serif';
    ctx.fillText('✓ ПРИСТУПИТЬ К РАБОТЕ', 70, bottomBarY + 36);

    this.checklistButtons.push({
      id: 'checklist_action',
      x: 36,
      y: bottomBarY,
      width: btn1W,
      height: btnH,
      onClick: () => this.closeChecklistModal()
    });

    // Кнопка 2: Переход к следующему шагу
    const btn2X = 436;
    const btn2W = 380;
    const isNextHover = this.hoveredButtonId === 'checklist_next_step';
    const nextTargetStep = Math.min(totalCount, currentStep + 1);

    ctx.fillStyle = isNextHover ? '#0284c7' : '#0369a1';
    this.fillRoundedRect(ctx, btn2X, bottomBarY, btn2W, btnH, 12);
    ctx.strokeStyle = isNextHover ? '#facc15' : '#38bdf8';
    ctx.lineWidth = isNextHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, btn2X, bottomBarY, btn2W, btnH, 12);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText(`⏩ СЛЕДУЮЩИЙ ШАГ (${nextTargetStep} из ${totalCount})`, btn2X + 34, bottomBarY + 36);

    this.checklistButtons.push({
      id: 'checklist_next_step',
      x: btn2X,
      y: bottomBarY,
      width: btn2W,
      height: btnH,
      onClick: () => {
        this.onAdvanceStepFromHud?.(nextTargetStep);
      }
    });

    // Кнопка 3: Закрыть окно
    const btn3X = 836;
    const btn3W = w - 36 - btn3X;
    const isExitHover = this.hoveredButtonId === 'checklist_exit';
    ctx.fillStyle = isExitHover ? '#475569' : '#334155';
    this.fillRoundedRect(ctx, btn3X, bottomBarY, btn3W, btnH, 12);
    ctx.strokeStyle = isExitHover ? '#facc15' : '#64748b';
    ctx.lineWidth = isExitHover ? 3 : 1.5;
    this.strokeRoundedRect(ctx, btn3X, bottomBarY, btn3W, btnH, 12);
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('ЗАКРЫТЬ [ESC]', btn3X + 75, bottomBarY + 36);

    this.checklistButtons.push({
      id: 'checklist_exit',
      x: btn3X,
      y: bottomBarY,
      width: btn3W,
      height: btnH,
      onClick: () => this.closeChecklistModal()
    });

    this.checklistTexture.needsUpdate = true;
  }

  // =========================================================================
  // Лазерное взаимодействие (Raycasting и клики по кнопкам VR UI)
  // =========================================================================
  public testRaycast(raycaster: THREE.Raycaster): VRInteractionHit | null {
    // 0. Проверяем модалку успешного завершения миссии
    if (this.isSuccessModalOpen) {
      const hits = raycaster.intersectObject(this.successMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.successCanvas.width;
        const py = (1 - uv.y) * this.successCanvas.height;

        this.reticleMesh.position.copy(hits[0].point);
        this.reticleMesh.quaternion.copy(this.successMesh.quaternion);
        this.reticleMesh.visible = true;

        const btn = this.successButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (this.hoveredButtonId !== btn?.id) {
          this.hoveredButtonId = btn?.id;
          if (this.currentSuccessData) {
            this.renderSuccessModal(this.currentSuccessData);
          }
        }
        return {
          panelId: 'success',
          buttonId: btn?.id,
          point: hits[0].point
        };
      }
    }

    // 0.5. Проверяем модалку чек-листа задач
    if (this.isChecklistModalOpen) {
      const hits = raycaster.intersectObject(this.checklistMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.checklistCanvas.width;
        const py = (1 - uv.y) * this.checklistCanvas.height;

        this.reticleMesh.position.copy(hits[0].point);
        this.reticleMesh.quaternion.copy(this.checklistMesh.quaternion);
        this.reticleMesh.visible = true;

        const btn = this.checklistButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (this.hoveredButtonId !== btn?.id) {
          this.hoveredButtonId = btn?.id;
          this.checklistTexture.needsUpdate = true;
        }
        return {
          panelId: 'checklist',
          buttonId: btn?.id,
          point: hits[0].point
        };
      }
    }

    // 1. Проверяем модалку отчета
    if (this.isReportModalOpen) {
      const hits = raycaster.intersectObject(this.reportMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.reportCanvas.width;
        const py = (1 - uv.y) * this.reportCanvas.height;

        this.reticleMesh.position.copy(hits[0].point);
        this.reticleMesh.quaternion.copy(this.reportMesh.quaternion);
        this.reticleMesh.visible = true;

        const btn = this.reportButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        return {
          panelId: 'report',
          buttonId: btn?.id,
          point: hits[0].point
        };
      }
    }

    // 2. Проверяем модалку ГОСТ
    if (this.isGostModalOpen) {
      const hits = raycaster.intersectObject(this.gostMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.gostCanvas.width;
        const py = (1 - uv.y) * this.gostCanvas.height;

        this.reticleMesh.position.copy(hits[0].point);
        this.reticleMesh.quaternion.copy(this.gostMesh.quaternion);
        this.reticleMesh.visible = true;

        const btn = this.gostButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        return {
          panelId: 'gost',
          buttonId: btn?.id,
          point: hits[0].point
        };
      }
    }

    // 3. Проверяем VR HUD и его интерактивные кнопки
    if (this.hudMesh.visible && this.rootGroup.visible) {
      const hits = raycaster.intersectObject(this.hudMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.hudCanvas.width;
        const py = (1 - uv.y) * this.hudCanvas.height;

        this.reticleMesh.position.copy(hits[0].point);
        this.reticleMesh.quaternion.copy(this.hudMesh.quaternion);
        this.reticleMesh.visible = true;

        const btn = this.hudButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (this.hoveredButtonId !== btn?.id) {
          this.hoveredButtonId = btn?.id;
          this.hudTexture.needsUpdate = true;
        }
        return {
          panelId: 'hud',
          buttonId: btn?.id,
          point: hits[0].point
        };
      }
    }

    if (this.hoveredButtonId !== undefined) {
      this.hoveredButtonId = undefined;
      this.hudTexture.needsUpdate = true;
    }
    this.reticleMesh.visible = false;
    return null;
  }

  /**
   * Клик курком по 3D UI
   * Возвращает true, если клик попал в интерактивную кнопку или поглощен интерфейсом
   */
  public triggerClick(raycaster: THREE.Raycaster): boolean {
    if (this.isSuccessModalOpen) {
      const hits = raycaster.intersectObject(this.successMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.successCanvas.width;
        const py = (1 - uv.y) * this.successCanvas.height;

        const btn = this.successButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (btn) {
          btn.onClick();
          return true;
        }
        return true;
      }
    }

    if (this.isChecklistModalOpen) {
      const hits = raycaster.intersectObject(this.checklistMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.checklistCanvas.width;
        const py = (1 - uv.y) * this.checklistCanvas.height;

        const btn = this.checklistButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (btn) {
          btn.onClick();
          return true;
        }
        return true;
      }
    }

    if (this.isReportModalOpen) {
      const hits = raycaster.intersectObject(this.reportMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.reportCanvas.width;
        const py = (1 - uv.y) * this.reportCanvas.height;

        const btn = this.reportButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (btn) {
          btn.onClick();
          return true;
        }
        return true; // поглощаем клик, чтобы не взаимодействовать сквозь окно
      }
    }

    if (this.isGostModalOpen) {
      const hits = raycaster.intersectObject(this.gostMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.gostCanvas.width;
        const py = (1 - uv.y) * this.gostCanvas.height;

        const btn = this.gostButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (btn) {
          btn.onClick();
          return true;
        }
        return true;
      }
    }

    if (this.hudMesh.visible && this.rootGroup.visible) {
      const hits = raycaster.intersectObject(this.hudMesh, false);
      if (hits.length > 0 && hits[0].uv) {
        const uv = hits[0].uv;
        const px = uv.x * this.hudCanvas.width;
        const py = (1 - uv.y) * this.hudCanvas.height;

        const btn = this.hudButtons.find(
          b => px >= b.x && px <= b.x + b.width && py >= b.y && py <= b.y + b.height
        );
        if (btn) {
          const normX = Math.max(0, Math.min(1, (px - btn.x) / Math.max(1, btn.width)));
          btn.onClick(normX, px);
          return true;
        }
        return true; // поглощаем клик по поверхности HUD, предотвращая паразитный захват объектов
      }
    }

    return false;
  }

  /**
   * Плавное перетаскивание ползунка виброотклика (Haptic Slider) при удержании курка контроллера
   */
  public triggerSliderDrag(raycaster: THREE.Raycaster): boolean {
    if (!this.hudMesh.visible || !this.rootGroup.visible || this.isReportModalOpen || this.isGostModalOpen) {
      return false;
    }
    const hits = raycaster.intersectObject(this.hudMesh, false);
    if (hits.length > 0 && hits[0].uv) {
      const uv = hits[0].uv;
      const px = uv.x * this.hudCanvas.width;
      const py = (1 - uv.y) * this.hudCanvas.height;

      const sliderBtn = this.hudButtons.find(
        b => b.id === 'haptic_slider_track' && px >= b.x - 20 && px <= b.x + b.width + 20 && py >= b.y - 15 && py <= b.y + b.height + 15
      );
      if (sliderBtn) {
        const normX = Math.max(0, Math.min(1, (px - sliderBtn.x) / Math.max(1, sliderBtn.width)));
        sliderBtn.onClick(normX, px);
        return true;
      }
    }
    return false;
  }

  // =========================================================================
  // Вспомогательные методы рисования Canvas
  // =========================================================================
  private fillRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fill();
  }

  public strokeRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.stroke();
  }

  /**
   * Включение / выключение плавающего 3D-окна аналитики с графиками D(t) и H(t) по кнопке A правого контроллера
   */
  public toggleAnalyticsWindow(): boolean {
    if (this.isReportModalOpen) {
      this.closeModals();
      return false;
    }
    this.onOpenAlaraFromHud?.();
    return this.isReportModalOpen;
  }
}
