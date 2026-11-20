/**
 * ALARA-Planner Pro VR — Модуль голосового протоколирования и голосовых команд (VoiceTaskLogger)
 *
 * Архитектурные гарантии:
 * 1. Распознавание речи и двойной режим работы (Web Speech API):
 *    - Базируется на window.SpeechRecognition / window.webkitSpeechRecognition
 *      с русской локализацией (lang = 'ru-RU'), continuous = true, interimResults = true.
 *    - Поддерживает два функциональных режима NLU/команд ('dictation' | 'commands') и гибридный авто-режим ('hybrid'):
 *      а) Режим протоколирования замеров (Dictation Log):
 *         Автоматический NLU-парсинг ключевых слов (локация/точка, мощность дозы мкЗв/ч или мЗв/ч,
 *         установленный защитный экран и его толщина в см/мм) с формированием строго типизированной записи:
 *         { id, timestamp, location, textNote, currentDoseRate, activeShielding, elapsedSec }.
 *      б) Режим голосового управления (Voice Commands):
 *         Выполнение системных действий без использования меню:
 *         - «Включить / выключить радиационный фон» -> вызов RadiationBackgroundField.toggle()
 *         - «Включить / выключить фонарь» -> вызов VRFlashlight.toggle()
 *         - «Экспорт отчета / CSV» -> генерация и сохранение CSV-файла замеров
 *         - «Сбросить дозу» -> обнуление интеграла накопленной дозы
 *         - «Свернуть / развернуть графики» -> переключение окна аналитики
 * 2. Активация Push-to-Talk и 3D-индикация в VR (VR HUD & Haptics):
 *    - Активация записи по удержанию кнопки на левом контроллере (кнопка X / Y или нажатие на стик Thumbstick Press),
 *      а также клавиши [V] или кнопки Push-to-Talk в интерфейсе для защиты от фонового шума.
 *    - 3D UI-индикатор микрофона (VRVoiceMicIndicator3D) на тыльной стороне левой кисти с анимированной
 *      пульсацией громкости звука (Web Audio API AnalyserNode + гармонический фоллбэк) и всплывающим
 *      прозрачным плавающим уведомителем (Toast Feed).
 *    - Короткий тактильный импульс gamepad.haptics[0].pulse(0.3, 50) (с поддержкой hapticActuators[0].pulse(0.3, 50))
 *      при старте Push-to-Talk и успешном завершении распознавания фразы.
 * 3. Устойчивость к ошибкам (Error Handling & Text Fallback):
 *    - Авто-перезапуск сессии при временном обрыве распознавания во время удержания Push-to-Talk.
 *    - Корректная обработка отсутствия микрофона / отказа в доступе / неподдерживаемого браузера
 *      с автоматическим переключением на текстовое логирование (submitTextFallback).
 */

import * as THREE from 'three';
import type { RadiationBackgroundField } from '../scene/radiationBackgroundField';
import type { VRFlashlight } from '../scene/handModel';

// ============================================================================
// Строгие декларации типов Web Speech API и расширений WebXR Gamepad Haptics
// ============================================================================
export interface SpeechRecognitionAlternative {
  readonly transcript: string;
  readonly confidence: number;
}

export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export type SpeechRecognitionErrorCode =
  | 'no-speech'
  | 'aborted'
  | 'audio-capture'
  | 'network'
  | 'not-allowed'
  | 'service-not-allowed'
  | 'bad-grammar'
  | 'language-not-supported';

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: SpeechRecognitionErrorCode;
  readonly message: string;
}

export interface ISpeechRecognition extends EventTarget {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onerror: ((this: ISpeechRecognition, ev: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((this: ISpeechRecognition, ev: SpeechRecognitionEvent) => void) | null;
  onsoundstart: ((this: ISpeechRecognition, ev: Event) => void) | null;
  onsoundend: ((this: ISpeechRecognition, ev: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type SpeechRecognitionConstructor = new () => ISpeechRecognition;

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }

  interface GamepadHapticActuator {
    pulse(value: number, duration: number): Promise<boolean>;
  }

  interface Gamepad {
    readonly haptics?: ReadonlyArray<{
      pulse: (value: number, duration: number) => Promise<boolean> | void;
    }>;
  }
}

// ============================================================================
// Доменные интерфейсы VoiceTaskLogger
// ============================================================================

/**
 * Структурированная запись журнала голосового протоколирования оператора
 */
export interface VoiceLogEntry {
  id: string;
  timestamp: string;
  elapsedSec: number;
  location: string;
  textNote: string;
  currentDoseRate: number;
  activeShielding: string;
}

/**
 * Режим работы обработчика NLU:
 * - 'dictation': приоритет записи измерений в протокол (но явные системные команды также распознаются)
 * - 'commands': строгий режим голосовых системных команд
 * - 'hybrid': автоматическое распознавание команд и надиктовки замеров
 */
export type VoiceLoggerMode = 'dictation' | 'commands' | 'hybrid';

/**
 * Поддерживаемые голосовые команды управления симулятором
 */
export type VoiceCommandType =
  | 'toggle_radiation_field'
  | 'toggle_flashlight'
  | 'export_csv'
  | 'reset_dose'
  | 'toggle_analytics';

export interface VoiceCommandMatch {
  command: VoiceCommandType;
  actionLabelRu: string;
  rawTranscript: string;
  targetState?: boolean;
}

export type VoiceLoggerStatus = 'idle' | 'listening' | 'processing' | 'fallback_text' | 'error';

/**
 * Элемент всплывающего плавающего уведомителя (Toast Feed) на дисплее левой руки / HUD
 */
export interface VoiceToastFeedItem {
  id: string;
  timestamp: string;
  kind: 'dictation' | 'command' | 'interim' | 'error';
  title: string;
  text: string;
  metaTag?: string;
  expiresAt: number;
}

/**
 * Снимок телеметрии симулятора в момент надиктовки (для автозаполнения полей, если они не названы голосом)
 */
export interface VoiceTelemetrySnapshot {
  elapsedSec: number;
  location: string;
  currentDoseRate: number;
  activeShielding: string;
}

/**
 * Системные коллбэки и прямые ссылки на модули симулятора для голосовых команд
 */
export interface VoiceTaskLoggerOptions {
  mode?: VoiceLoggerMode;
  radiationField?: RadiationBackgroundField | null;
  flashlight?: VRFlashlight | null;
  getTelemetrySnapshot: () => VoiceTelemetrySnapshot;
  getXRSession?: () => XRSession | null;
  onToggleRadiationField?: (forceState?: boolean) => boolean | void;
  onToggleFlashlight?: (forceState?: boolean) => boolean | void;
  onExportCsv?: () => void;
  onResetDose?: () => void;
  onToggleAnalytics?: (forceExpanded?: boolean) => void;
  onLogEntryAdded?: (entry: VoiceLogEntry) => void;
  onCommandExecuted?: (match: VoiceCommandMatch) => void;
  onToastFeedUpdate?: (feed: ReadonlyArray<VoiceToastFeedItem>, latest: VoiceToastFeedItem | null) => void;
  onStateChange?: (state: {
    status: VoiceLoggerStatus;
    isPushToTalkActive: boolean;
    mode: VoiceLoggerMode;
    interimTranscript: string;
    volumeLevel: number;
    isSpeechSupported: boolean;
    isMicAvailable: boolean;
    errorMessage: string | null;
  }) => void;
}

// ============================================================================
// 3D UI-индикатор микрофона и плавающего Toast Feed на тыльной стороне левой кисти
// ============================================================================

export class VRVoiceMicIndicator3D {
  public readonly rootGroup: THREE.Group;
  private readonly micBadgeGroup: THREE.Group;
  private readonly outerPulseRing: THREE.Mesh;
  private readonly innerWaveRing: THREE.Mesh;
  private readonly micCoreMesh: THREE.Mesh;
  private readonly micCoreMat: THREE.MeshStandardMaterial;
  private readonly outerRingMat: THREE.MeshBasicMaterial;
  private readonly innerRingMat: THREE.MeshBasicMaterial;

  // Всплывающий прозрачный 3D Toast Feed над левым запястьем
  public readonly toastFeedMesh: THREE.Mesh;
  private readonly toastCanvas: HTMLCanvasElement;
  private readonly toastCtx: CanvasRenderingContext2D;
  private readonly toastTexture: THREE.CanvasTexture;

  private pulsePhase = 0;

  constructor() {
    this.rootGroup = new THREE.Group();
    this.rootGroup.name = 'vr_voice_mic_indicator_3d';
    // Размещаем на тыльной стороне левой кисти чуть выше наручного планшета VRWristDisplay
    this.rootGroup.position.set(0.016, 0.068, 0.005);
    this.rootGroup.rotation.set(-Math.PI / 3.2, 0, 0);

    this.micBadgeGroup = new THREE.Group();
    this.micBadgeGroup.position.set(-0.068, 0.036, 0.008);
    this.rootGroup.add(this.micBadgeGroup);

    // 1. Базовый корпус 3D-микрофона на запястье
    const baseGeo = new THREE.CylinderGeometry(0.013, 0.014, 0.004, 24);
    baseGeo.rotateX(Math.PI / 2);
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.35,
      metalness: 0.7
    });
    const baseDisc = new THREE.Mesh(baseGeo, baseMat);
    this.micBadgeGroup.add(baseDisc);

    // 2. Светящееся ядро микрофона (меняет цвет: серый idle / изумрудный или голубой PTT / красный rec)
    const coreGeo = new THREE.SphereGeometry(0.0065, 16, 16);
    this.micCoreMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      emissive: 0x0f172a,
      emissiveIntensity: 0.4,
      roughness: 0.25,
      metalness: 0.3
    });
    this.micCoreMesh = new THREE.Mesh(coreGeo, this.micCoreMat);
    this.micCoreMesh.position.set(0, 0, 0.003);
    this.micBadgeGroup.add(this.micCoreMesh);

    // 3. Внутреннее и внешнее кольца анимированной пульсации громкости голоса
    const innerRingGeo = new THREE.RingGeometry(0.009, 0.0115, 32);
    this.innerRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    this.innerWaveRing = new THREE.Mesh(innerRingGeo, this.innerRingMat);
    this.innerWaveRing.position.set(0, 0, 0.0035);
    this.micBadgeGroup.add(this.innerWaveRing);

    const outerRingGeo = new THREE.RingGeometry(0.0135, 0.0165, 32);
    this.outerRingMat = new THREE.MeshBasicMaterial({
      color: 0x22c55e,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.0
    });
    this.outerPulseRing = new THREE.Mesh(outerRingGeo, this.outerRingMat);
    this.outerPulseRing.position.set(0, 0, 0.004);
    this.micBadgeGroup.add(this.outerPulseRing);

    // 4. Плавающий прозрачный 3D Toast Feed для вывода распознанного текста на левую руку
    this.toastCanvas = document.createElement('canvas');
    this.toastCanvas.width = 640;
    this.toastCanvas.height = 180;
    this.toastCtx = this.toastCanvas.getContext('2d')!;

    this.toastTexture = new THREE.CanvasTexture(this.toastCanvas);
    this.toastTexture.colorSpace = THREE.SRGBColorSpace;
    this.toastTexture.minFilter = THREE.LinearFilter;
    this.toastTexture.magFilter = THREE.LinearFilter;

    const toastGeo = new THREE.PlaneGeometry(0.21, 0.06);
    const toastMat = new THREE.MeshBasicMaterial({
      map: this.toastTexture,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.96,
      depthWrite: false
    });

    this.toastFeedMesh = new THREE.Mesh(toastGeo, toastMat);
    this.toastFeedMesh.position.set(0.012, 0.044, 0.012);
    this.toastFeedMesh.visible = false;
    this.rootGroup.add(this.toastFeedMesh);
  }

  /**
   * Плавная 3D-анимация пульсации микрофона пропорционально уровню громкости голоса
   */
  public updateAnimation(
    dt: number,
    isListening: boolean,
    volumeLevel: number,
    mode: VoiceLoggerMode,
    hasError: boolean
  ): void {
    this.pulsePhase += dt * (isListening ? 8.5 + volumeLevel * 12.0 : 2.0);
    const clampedVol = THREE.MathUtils.clamp(volumeLevel, 0, 1);

    if (hasError) {
      this.micCoreMat.color.setHex(0xef4444);
      this.micCoreMat.emissive.setHex(0xef4444);
      this.micCoreMat.emissiveIntensity = 1.1;
      this.innerRingMat.opacity = 0.45;
      this.innerRingMat.color.setHex(0xef4444);
      this.outerRingMat.opacity = 0.0;
      this.micCoreMesh.scale.setScalar(1.0);
      return;
    }

    if (isListening) {
      const activeColor = mode === 'commands' ? 0x38bdf8 : 0x22c55e;
      this.micCoreMat.color.setHex(activeColor);
      this.micCoreMat.emissive.setHex(activeColor);

      const wave = 0.5 + 0.5 * Math.sin(this.pulsePhase);
      const dynamicAmp = Math.max(wave * 0.35, clampedVol);

      this.micCoreMat.emissiveIntensity = 1.2 + dynamicAmp * 1.8;
      this.micCoreMesh.scale.setScalar(1.0 + dynamicAmp * 0.38);

      this.innerRingMat.color.setHex(activeColor);
      this.innerRingMat.opacity = 0.55 + dynamicAmp * 0.45;
      this.innerWaveRing.scale.setScalar(1.0 + dynamicAmp * 0.55);

      this.outerRingMat.color.setHex(0xfacc15);
      this.outerRingMat.opacity = 0.25 + dynamicAmp * 0.65;
      this.outerPulseRing.scale.setScalar(1.0 + dynamicAmp * 0.95);
    } else {
      this.micCoreMat.color.setHex(0x64748b);
      this.micCoreMat.emissive.setHex(0x1e293b);
      this.micCoreMat.emissiveIntensity = 0.35;
      this.micCoreMesh.scale.setScalar(1.0);
      this.innerRingMat.opacity = 0.18;
      this.innerRingMat.color.setHex(0x475569);
      this.innerWaveRing.scale.setScalar(1.0);
      this.outerRingMat.opacity = 0.0;
      this.outerPulseRing.scale.setScalar(1.0);
    }
  }

  /**
   * Отрисовка всплывающего прозрачного плавающего уведомителя (Toast Feed) на левой руке
   */
  public renderToastFeed(
    isListening: boolean,
    interimTranscript: string,
    latestToast: VoiceToastFeedItem | null,
    volumeLevel: number,
    mode: VoiceLoggerMode
  ): void {
    const showInterim = isListening && interimTranscript.trim().length > 0;
    const now = performance.now();
    const showToast = latestToast !== null && now < latestToast.expiresAt;

    if (!isListening && !showToast) {
      this.toastFeedMesh.visible = false;
      return;
    }

    this.toastFeedMesh.visible = true;
    const ctx = this.toastCtx;
    const w = this.toastCanvas.width;
    const h = this.toastCanvas.height;
    ctx.clearRect(0, 0, w, h);

    // Полупрозрачный корпус плавающего тоста
    const isCmd = latestToast?.kind === 'command' || mode === 'commands';
    const borderCol = isListening
      ? '#22c55e'
      : latestToast?.kind === 'error'
      ? '#ef4444'
      : isCmd
      ? '#38bdf8'
      : '#eab308';

    ctx.fillStyle = 'rgba(9, 13, 22, 0.88)';
    this.fillRoundedRect(ctx, 4, 4, w - 8, h - 8, 18);

    ctx.strokeStyle = borderCol;
    ctx.lineWidth = 3;
    this.strokeRoundedRect(ctx, 4, 4, w - 8, h - 8, 18);

    // Индикатор эквалайзера голоса справа вверху
    const barsCount = 8;
    const barBaseX = w - 110;
    for (let i = 0; i < barsCount; i++) {
      const factor = isListening
        ? Math.max(0.18, Math.min(1.0, volumeLevel * (0.6 + 0.4 * Math.sin(now * 0.015 + i))))
        : 0.15;
      const barH = Math.round(8 + factor * 24);
      ctx.fillStyle = isListening ? '#4ade80' : '#475569';
      ctx.fillRect(barBaseX + i * 11, 28 - Math.floor(barH / 2), 7, barH);
    }

    // Заголовок режима
    ctx.fillStyle = borderCol;
    ctx.font = 'bold 22px monospace';
    const headerTitle = isListening
      ? `🎙 PTT АКТИВЕН [${mode === 'commands' ? 'КОМАНДЫ' : 'ПРОТОКОЛ'}]`
      : latestToast?.title || '🎙 ГОЛОСОВОЙ ЖУРНАЛ ALARA';
    ctx.fillText(headerTitle.slice(0, 38), 22, 38);

    // Основной распознанный текст
    ctx.fillStyle = '#f8fafc';
    ctx.font = '21px sans-serif';
    const rawText = showInterim
      ? interimTranscript
      : isListening
      ? 'Говорите в микрофон (удерживайте кнопку PTT)...'
      : latestToast?.text || '';
    const line1 = rawText.length > 48 ? rawText.slice(0, 48) : rawText;
    const line2 = rawText.length > 48 ? rawText.slice(48, 94) + (rawText.length > 94 ? '...' : '') : '';
    ctx.fillText(line1, 22, 78);
    if (line2) {
      ctx.fillText(line2, 22, 108);
    }

    // Нижняя строка метаданных (локация, мкЗв/ч, экран)
    if (latestToast?.metaTag && !showInterim) {
      ctx.fillStyle = '#fef08a';
      ctx.font = 'bold 17px monospace';
      ctx.fillText(latestToast.metaTag.slice(0, 56), 22, 152);
    } else if (isListening) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '16px monospace';
      ctx.fillText('Отпустите кнопку PTT [Y / Стик / V] для фиксации', 22, 152);
    }

    this.toastTexture.needsUpdate = true;
  }

  private fillRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.fill();
  }

  private strokeRoundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number
  ): void {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
    ctx.stroke();
  }
}

// ============================================================================
// Основной класс VoiceTaskLogger
// ============================================================================

export class VoiceTaskLogger {
  private readonly options: VoiceTaskLoggerOptions;
  private recognition: ISpeechRecognition | null = null;

  public mode: VoiceLoggerMode;
  public status: VoiceLoggerStatus = 'idle';
  public isPushToTalkActive = false;
  public isSpeechSupported = false;
  public isMicAvailable = true;
  public interimTranscript = '';
  public volumeLevel = 0;
  public errorMessage: string | null = null;

  // Журнал распознанных записей протокола и стек уведомлений Toast Feed
  private readonly logs: VoiceLogEntry[] = [];
  private readonly toastFeed: VoiceToastFeedItem[] = [];
  private logSequence = 1;

  // 3D-индикатор микрофона и плавающего Toast-дисплея для левой руки в VR
  public readonly micIndicator3D: VRVoiceMicIndicator3D;

  // Web Audio API анализатор громкости микрофона для честной пульсации 3D-индикатора
  private audioContext: AudioContext | null = null;
  private mediaStream: MediaStream | null = null;
  private analyserNode: AnalyserNode | null = null;
  private pcmBuffer: Uint8Array<ArrayBuffer> | null = null;
  private isAudioMeterInitialising = false;

  // Авто-перезапуск при временном обрыве сессии Web Speech API
  private restartTimerId: number | null = null;
  private restartAttempts = 0;
  private readonly MAX_RESTART_ATTEMPTS = 5;
  private isRecognitionRunning = false;
  private pendingFinalBuffer = '';

  constructor(options: VoiceTaskLoggerOptions) {
    this.options = options;
    this.mode = options.mode ?? 'hybrid';
    this.micIndicator3D = new VRVoiceMicIndicator3D();

    this.initSpeechRecognition();
  }

  /**
   * Инициализация Web Speech API (window.SpeechRecognition / webkitSpeechRecognition)
   * с русской локализацией ('ru-RU'), continuous = true, interimResults = true
   */
  private initSpeechRecognition(): void {
    if (typeof window === 'undefined') {
      this.isSpeechSupported = false;
      this.status = 'fallback_text';
      return;
    }

    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognitionCtor) {
      this.isSpeechSupported = false;
      this.status = 'fallback_text';
      this.errorMessage =
        'Web Speech API не поддерживается в данном браузере. Активирован текстовый фоллбэк протоколирования.';
      this.notifyStateChange();
      return;
    }

    this.isSpeechSupported = true;
    const rec = new SpeechRecognitionCtor();
    rec.lang = 'ru-RU';
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      this.isRecognitionRunning = true;
      this.restartAttempts = 0;
      if (this.isPushToTalkActive) {
        this.status = 'listening';
        this.errorMessage = null;
      }
      this.notifyStateChange();
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = '';
      let finalChunk = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        const transcript = res[0]?.transcript ?? '';
        if (res.isFinal) {
          finalChunk += transcript + ' ';
        } else {
          interim += transcript;
        }
      }

      this.interimTranscript = interim.trim();
      if (this.interimTranscript.length > 0) {
        // Легкая модуляция уровня громкости при поступлении фонем, если прямой MediaStream недоступен
        if (!this.analyserNode) {
          this.volumeLevel = Math.min(1.0, 0.45 + (this.interimTranscript.length % 7) * 0.08);
        }
      }

      if (finalChunk.trim().length > 0) {
        const cleanedFinal = finalChunk.trim();
        this.pendingFinalBuffer = '';
        this.interimTranscript = '';
        this.processRecognizedPhrase(cleanedFinal);
      } else {
        this.pendingFinalBuffer = this.interimTranscript;
        this.notifyStateChange();
      }
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      const code = event.error;

      // При временном отсутствии речи во время удержания кнопки PTT не считаем это фатальной ошибкой
      if (code === 'no-speech' || code === 'aborted') {
        return;
      }

      if (code === 'not-allowed' || code === 'service-not-allowed' || code === 'audio-capture') {
        this.isMicAvailable = false;
        this.isPushToTalkActive = false;
        this.status = 'fallback_text';
        this.errorMessage =
          code === 'audio-capture'
            ? 'Микрофон не обнаружен. Используйте текстовый ввод протокола ALARA.'
            : 'Доступ к микрофону ограничен. Включен режим текстового протоколирования.';
        this.pushToastItem({
          kind: 'error',
          title: 'ФОЛЛБЭК: ТЕКСТОВЫЙ ПРОТОКОЛ',
          text: this.errorMessage
        });
        this.notifyStateChange();
        return;
      }

      // Сетевой или временный сбой распознавания -> авто-перезапуск сессии
      this.errorMessage = `Временный сбой Speech API (${code}). Авто-перезапуск...`;
      if (this.isPushToTalkActive) {
        this.scheduleAutoRestart();
      }
      this.notifyStateChange();
    };

    rec.onend = () => {
      this.isRecognitionRunning = false;

      // Если пользователь отпустил PTT, но осталась незавершенная interim-фраза — фиксируем её!
      if (!this.isPushToTalkActive && this.pendingFinalBuffer.trim().length > 0) {
        const leftover = this.pendingFinalBuffer.trim();
        this.pendingFinalBuffer = '';
        this.interimTranscript = '';
        this.processRecognizedPhrase(leftover);
      }

      // Авто-перезапуск сессии при внезапном обрыве во время удержания кнопки Push-to-Talk
      if (this.isPushToTalkActive && this.isMicAvailable && this.isSpeechSupported) {
        this.scheduleAutoRestart();
      } else if (this.status !== 'fallback_text') {
        this.status = 'idle';
        this.volumeLevel = 0;
        this.notifyStateChange();
      }
    };

    this.recognition = rec;
  }

  /**
   * Авто-перезапуск сессии распознавания при временном обрыве связи или таймауте браузера
   */
  private scheduleAutoRestart(): void {
    if (this.restartTimerId !== null) {
      window.clearTimeout(this.restartTimerId);
      this.restartTimerId = null;
    }

    if (this.restartAttempts >= this.MAX_RESTART_ATTEMPTS) {
      this.status = 'fallback_text';
      this.isPushToTalkActive = false;
      this.errorMessage = 'Превышен лимит попыток подключения к Speech API. Доступен текстовый ввод.';
      this.notifyStateChange();
      return;
    }

    this.restartAttempts++;
    const delayMs = Math.min(1200, 180 * this.restartAttempts);
    this.restartTimerId = window.setTimeout(() => {
      this.restartTimerId = null;
      if (this.isPushToTalkActive && this.recognition && !this.isRecognitionRunning) {
        try {
          this.recognition.start();
        } catch {
          // Игнорируем ошибку повторного старта, если сессия уже поднялась
        }
      }
    }, delayMs);
  }

  /**
   * Инициализация Web Audio API AnalyserNode для реальной визуализации амплитуды голоса в 3D
   */
  private async ensureAudioVolumeMeter(): Promise<void> {
    if (
      this.analyserNode ||
      this.isAudioMeterInitialising ||
      !this.isMicAvailable ||
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices?.getUserMedia
    ) {
      return;
    }

    this.isAudioMeterInitialising = true;
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.audioContext = new AudioCtx();
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      const analyser = this.audioContext.createAnalyser();
      analyser.fftSize = 256;
      analyser.smoothingTimeConstant = 0.65;
      source.connect(analyser);
      this.analyserNode = analyser;
      this.pcmBuffer = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
    } catch {
      // Если прямой захват потока заблокирован политикой iframe, используем гармоническую модуляцию речи
    } finally {
      this.isAudioMeterInitialising = false;
    }
  }

  /**
   * Привязка актуальных экземпляров 3D-поля радиации и VR-фонаря левой руки
   */
  public bindSceneEquipment(
    radiationField: RadiationBackgroundField | null,
    flashlight: VRFlashlight | null
  ): void {
    this.options.radiationField = radiationField;
    this.options.flashlight = flashlight;
  }

  public setMode(mode: VoiceLoggerMode): void {
    this.mode = mode;
    this.pushToastItem({
      kind: 'command',
      title:
        mode === 'commands'
          ? 'РЕЖИМ: ГОЛОСОВЫЕ КОМАНДЫ'
          : mode === 'dictation'
          ? 'РЕЖИМ: ДИКТОВКА ЗАМЕРОВ'
          : 'РЕЖИМ: АВТО (КОМАНДЫ + ЛОГ)',
      text:
        mode === 'commands'
          ? 'Скажите: «Включить фонарь», «Выключить радиационный фон», «Экспорт CSV», «Сбросить дозу»'
          : 'Надиктуйте замер: «Точка А-1, мощность дозы 45 мкЗв/ч, установлен свинцовый экран 2 см»'
    });
    this.notifyStateChange();
  }

  /**
   * Активация записи Push-to-Talk (при нажатии и удержании кнопки X/Y или Thumbstick на левом контроллере VR)
   */
  public startPushToTalk(): void {
    if (this.isPushToTalkActive) return;
    this.isPushToTalkActive = true;
    this.pendingFinalBuffer = '';
    this.interimTranscript = '';

    // Короткий тактильный импульс gamepad.haptics[0].pulse(0.3, 50) на левом контроллере при старте записи
    this.triggerControllerVoiceHaptic(0.3, 50);

    if (!this.isSpeechSupported || !this.isMicAvailable || !this.recognition) {
      this.status = 'fallback_text';
      this.pushToastItem({
        kind: 'error',
        title: 'ТЕКСТОВЫЙ РЕЖИМ ПРОТОКОЛА',
        text: 'Микрофон недоступен в браузере. Используйте панель быстрого ввода заметки.'
      });
      this.notifyStateChange();
      return;
    }

    this.status = 'listening';
    this.errorMessage = null;
    void this.ensureAudioVolumeMeter();

    if (!this.isRecognitionRunning) {
      try {
        this.recognition.start();
      } catch {
        // Сессия уже запущена
      }
    }

    this.notifyStateChange();
  }

  /**
   * Завершение удержания Push-to-Talk (при отпускании кнопки на левом контроллере VR)
   */
  public stopPushToTalk(): void {
    if (!this.isPushToTalkActive) return;
    this.isPushToTalkActive = false;

    if (this.restartTimerId !== null) {
      window.clearTimeout(this.restartTimerId);
      this.restartTimerId = null;
    }

    if (this.recognition && this.isRecognitionRunning) {
      try {
        this.recognition.stop();
      } catch {
        // Игнорируем исключение при остановке
      }
    }

    // Если в буфере осталась распознанная на лету фраза — обрабатываем её без потерь
    if (this.pendingFinalBuffer.trim().length > 0) {
      const phrase = this.pendingFinalBuffer.trim();
      this.pendingFinalBuffer = '';
      this.interimTranscript = '';
      this.processRecognizedPhrase(phrase);
    } else if (this.status !== 'fallback_text') {
      this.status = 'idle';
      this.volumeLevel = 0;
      this.notifyStateChange();
    }
  }

  /**
   * Переключение Push-to-Talk одним нажатием (для десктопного UI и кнопки VR HUD)
   */
  public togglePushToTalk(): boolean {
    if (this.isPushToTalkActive) {
      this.stopPushToTalk();
      return false;
    } else {
      this.startPushToTalk();
      return true;
    }
  }

  /**
   * Унифицированный старт записи голоса по удержанию кнопки X левого VR-контроллера (Push-to-Talk Hold)
   */
  public startListening(_gamepad?: Gamepad): void {
    this.startPushToTalk();
  }

  /**
   * Унифицированное завершение записи фразы при отпускании кнопки X левого VR-контроллера
   */
  public stopListening(_gamepad?: Gamepad): void {
    this.stopPushToTalk();
  }

  /**
   * Фоллбэк на текстовое логирование / выполнение голосовых команд без микрофона
   */
  public submitTextFallback(rawText: string, modeOverride?: VoiceLoggerMode): VoiceLogEntry | VoiceCommandMatch | null {
    const cleaned = rawText.trim();
    if (!cleaned) return null;

    const prevMode = this.mode;
    if (modeOverride) {
      this.mode = modeOverride;
    }
    const result = this.processRecognizedPhrase(cleaned);
    if (modeOverride) {
      this.mode = prevMode;
    }
    return result;
  }

  /**
   * Центральный диспетчер распознанной фразы (NLU: Голосовые команды vs Протоколирование замеров)
   */
  private processRecognizedPhrase(transcript: string): VoiceLogEntry | VoiceCommandMatch | null {
    const cleanText = transcript.trim();
    if (!cleanText) return null;

    this.status = 'processing';

    // 1. Проверяем соответствие системным голосовым командам
    const commandMatch = this.matchVoiceCommand(cleanText);
    if (commandMatch && (this.mode === 'commands' || this.mode === 'hybrid' || this.isStrictSystemCommand(cleanText))) {
      this.executeVoiceCommand(commandMatch);
      // Тактильное подтверждение успешного выполнения фразы: gamepad.haptics[0].pulse(0.3, 50)
      this.triggerControllerVoiceHaptic(0.3, 50);
      this.status = this.isPushToTalkActive ? 'listening' : 'idle';
      this.notifyStateChange();
      return commandMatch;
    }

    // Если включен строго командный режим, но команда не распознана — подсказываем оператору
    if (this.mode === 'commands' && !commandMatch) {
      this.pushToastItem({
        kind: 'error',
        title: 'КОМАНДА НЕ РАСПОЗНАНА',
        text: `«${cleanText}» — скажите: фонарь, радиационный фон, экспорт CSV, сбросить дозу, графики`
      });
      this.status = this.isPushToTalkActive ? 'listening' : 'idle';
      this.notifyStateChange();
      return null;
    }

    // 2. Режим протоколирования замеров (Dictation Log): парсинг ключевых слов и создание записи журнала
    const snapshot = this.options.getTelemetrySnapshot();
    const entry = this.parseDictationToLogEntry(cleanText, snapshot);
    this.logs.push(entry);

    // Короткий тактильный импульс при успешном завершении распознавания фразы: gamepad.haptics[0].pulse(0.3, 50)
    this.triggerControllerVoiceHaptic(0.3, 50);

    this.pushToastItem({
      kind: 'dictation',
      title: `✓ ЗАПИСЬ В ПРОТОКОЛ [${entry.location}]`,
      text: entry.textNote,
      metaTag: `H: ${entry.currentDoseRate.toFixed(1)} мкЗв/ч • Экран: ${entry.activeShielding}`
    });

    this.options.onLogEntryAdded?.(entry);
    this.status = this.isPushToTalkActive ? 'listening' : 'idle';
    this.notifyStateChange();
    return entry;
  }

  /**
   * Проверка, является ли фраза короткой однозначной системной командой
   */
  private isStrictSystemCommand(text: string): boolean {
    const lower = text.toLowerCase().replace(/ё/g, 'е');
    return (
      /^(включи|выключи|отключи|переключи|сбрось|сбросить|экспорт|скачать|сверни|свернуть|разверни|развернуть)\b/.test(
        lower
      ) && lower.split(/\s+/).length <= 5
    );
  }

  /**
   * Распознавание системных голосовых команд (Voice Commands NLU)
   */
  public matchVoiceCommand(transcript: string): VoiceCommandMatch | null {
    const norm = transcript
      .toLowerCase()
      .replace(/ё/g, 'е')
      .replace(/[.,!?;:«»"']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    // 1. «Включить / выключить радиационный фон» -> RadiationBackgroundField.toggle()
    if (
      (norm.includes('радиационн') && (norm.includes('фон') || norm.includes('поле'))) ||
      (norm.includes('гамма') && (norm.includes('фон') || norm.includes('поле'))) ||
      (norm.includes('визуализац') && norm.includes('фон'))
    ) {
      const turnOff =
        norm.includes('выключ') || norm.includes('отключ') || norm.includes('скрой') || norm.includes('убрать');
      const turnOn =
        !turnOff && (norm.includes('включ') || norm.includes('покаж') || norm.includes('активир'));
      const targetState = turnOff ? false : turnOn ? true : undefined;
      return {
        command: 'toggle_radiation_field',
        actionLabelRu:
          targetState === true
            ? 'Радиационный фон включен'
            : targetState === false
            ? 'Радиационный фон выключен'
            : 'Переключен радиационный фон',
        rawTranscript: transcript,
        targetState
      };
    }

    // 2. «Включить / выключить фонарь» -> VRFlashlight.toggle()
    if (norm.includes('фонар') || norm.includes('прожектор') || norm.includes('подсветк')) {
      const turnOff = norm.includes('выключ') || norm.includes('отключ') || norm.includes('погас');
      const turnOn = !turnOff && (norm.includes('включ') || norm.includes('зажг') || norm.includes('активир'));
      const targetState = turnOff ? false : turnOn ? true : undefined;
      return {
        command: 'toggle_flashlight',
        actionLabelRu:
          targetState === true
            ? 'Тактический фонарь ВКЛ'
            : targetState === false
            ? 'Тактический фонарь ВЫКЛ'
            : 'Переключен тактический фонарь',
        rawTranscript: transcript,
        targetState
      };
    }

    // 3. «Экспорт отчета / CSV» -> генерация и сохранение файла замеров
    if (
      norm.includes('экспорт') ||
      norm.includes('csv') ||
      norm.includes('си эс ви') ||
      norm.includes('таблиц') ||
      (norm.includes('скача') && (norm.includes('отчет') || norm.includes('протокол') || norm.includes('данн'))) ||
      (norm.includes('сохран') && (norm.includes('отчет') || norm.includes('протокол')))
    ) {
      return {
        command: 'export_csv',
        actionLabelRu: 'Экспорт CSV-отчета с голосовым протоколом',
        rawTranscript: transcript
      };
    }

    // 4. «Сбросить дозу» -> обнуление интеграла накопленной дозы
    if (
      (norm.includes('сброс') || norm.includes('обнул') || norm.includes('очист')) &&
      (norm.includes('доз') || norm.includes('интеграл') || norm.includes('счетчик'))
    ) {
      return {
        command: 'reset_dose',
        actionLabelRu: 'Сброс интеграла накопленной дозы H(t)',
        rawTranscript: transcript
      };
    }

    // 5. «Свернуть / развернуть графики» -> переключение окна аналитики
    if (
      norm.includes('график') ||
      norm.includes('аналитик') ||
      (norm.includes('окно') && (norm.includes('сверн') || norm.includes('разверн')))
    ) {
      const collapse = norm.includes('сверн') || norm.includes('скрой') || norm.includes('скрыт') || norm.includes('закр');
      const expand = !collapse && (norm.includes('разверн') || norm.includes('откр') || norm.includes('покаж'));
      const targetState = expand ? true : collapse ? false : undefined;
      return {
        command: 'toggle_analytics',
        actionLabelRu:
          targetState === true
            ? 'Окно аналитики развернуто'
            : targetState === false
            ? 'Окно аналитики свернуто'
            : 'Переключено окно графиков аналитики',
        rawTranscript: transcript,
        targetState
      };
    }

    return null;
  }

  /**
   * Выполнение распознанной системной голосовой команды
   */
  private executeVoiceCommand(match: VoiceCommandMatch): void {
    switch (match.command) {
      case 'toggle_radiation_field': {
        if (this.options.onToggleRadiationField) {
          this.options.onToggleRadiationField(match.targetState);
        } else if (this.options.radiationField) {
          if (match.targetState !== undefined) {
            this.options.radiationField.setEnabled(match.targetState);
          } else {
            this.options.radiationField.toggle();
          }
        }
        break;
      }
      case 'toggle_flashlight': {
        if (this.options.onToggleFlashlight) {
          this.options.onToggleFlashlight(match.targetState);
        } else if (this.options.flashlight) {
          if (match.targetState !== undefined) {
            this.options.flashlight.setPower(match.targetState);
          } else {
            this.options.flashlight.toggle();
          }
        }
        break;
      }
      case 'export_csv': {
        this.options.onExportCsv?.();
        break;
      }
      case 'reset_dose': {
        this.options.onResetDose?.();
        break;
      }
      case 'toggle_analytics': {
        this.options.onToggleAnalytics?.(match.targetState);
        break;
      }
    }

    this.pushToastItem({
      kind: 'command',
      title: `⚡ КОМАНДА: ${match.actionLabelRu.toUpperCase()}`,
      text: `Распознано: «${match.rawTranscript}»`
    });

    this.options.onCommandExecuted?.(match);
  }

  /**
   * Автоматический NLU-парсинг речевой заметки оператора в объект журнала VoiceLogEntry:
   * Пример фразы: «Точка А-1, мощность дозы 45 мкЗв/ч, установлен свинцовый экран 2 см»
   */
  public parseDictationToLogEntry(
    transcript: string,
    snapshot: VoiceTelemetrySnapshot
  ): VoiceLogEntry {
    const cleanNote = transcript.trim();
    const norm = cleanNote.replace(/ё/g, 'е');

    // 1. Парсинг локации / контрольной точки («Точка А-1», «Сектор 2», «Бокс 3», «Узел Б-4», «Зона реактора»)
    let parsedLocation = snapshot.location || 'Точка контроля';
    const locRegex =
      /(?:точк[аеиу]|сектор[еа]?|бокс[еа]?|узел|узл[еа]|зон[аеу]|помещени[еи]|камер[ае])\s*(?:№|номер)?\s*([А-Яа-яA-Za-z0-9]+(?:\s*[-–]\s*[А-Яа-яA-Za-z0-9]+)?)/i;
    const locMatch = norm.match(locRegex);
    if (locMatch && locMatch[0]) {
      parsedLocation = locMatch[0]
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^([а-яa-z])/i, c => c.toUpperCase());
    }

    // 2. Парсинг мощности дозы из текста (например: «мощность дозы 45 мкЗв/ч», «фон 1.5 мЗв/ч», «доза 120 микрозиверт»)
    let parsedDoseRate = Number(snapshot.currentDoseRate.toFixed(2));
    const doseRegex =
      /(?:мощност[ьи]\s+доз[ыа]|фон|показани[яе]|доза|уровень)?\s*(\d+(?:[.,]\d+)?)\s*(мкзв|микрозиверт[а-я]*|мзв|миллизиверт[а-я]*)/i;
    const doseMatch = norm.match(doseRegex);
    if (doseMatch && doseMatch[1]) {
      const numericVal = parseFloat(doseMatch[1].replace(',', '.'));
      const unitStr = (doseMatch[2] || '').toLowerCase();
      if (!Number.isNaN(numericVal)) {
        const isMilliSv = unitStr.startsWith('мзв') || unitStr.startsWith('милли');
        parsedDoseRate = Number((isMilliSv ? numericVal * 1000 : numericVal).toFixed(2));
      }
    }

    // 3. Парсинг установленного защитного экрана и его толщины («установлен свинцовый экран 2 см», «бетон 20 см», «контейнер ТК-6»)
    let parsedShielding = snapshot.activeShielding || 'Без экрана';
    const shieldMaterialRegex =
      /(?:установлен[аоы]?|применен[аоы]?|поставлен[аоы]?|защит[аы]|экран[ирование]*|ширм[аы])?\s*(свинц[а-я]*|баритобетон[а-я]*|бетон[а-я]*|полиэтилен[а-я]*|парафин[а-я]*|вольфрам[а-я]*|контейнер[а-я]*\s*(?:тк[-–]?6)?)(?:\s+(?:экран|ширма|плита|блок|защита))?(?:\s+(?:толщин[ойдй]+\s*)?(\d+(?:[.,]\d+)?)\s*(см|сантиметр[а-я]*|мм|миллиметр[а-я]*))?/i;
    const shieldMatch = norm.match(shieldMaterialRegex);

    if (norm.toLowerCase().includes('без экран') || norm.toLowerCase().includes('без защит')) {
      parsedShielding = 'Без экрана (открытый источник)';
    } else if (shieldMatch && shieldMatch[1]) {
      const rawMat = shieldMatch[1].toLowerCase();
      let matName = 'Защитный экран';
      if (rawMat.startsWith('свинц')) matName = 'Свинцовый экран';
      else if (rawMat.startsWith('барито')) matName = 'Баритобетон';
      else if (rawMat.startsWith('бетон')) matName = 'Бетонный экран';
      else if (rawMat.startsWith('полиэт')) matName = 'Борированный полиэтилен';
      else if (rawMat.startsWith('парафин')) matName = 'Парафиновый экран';
      else if (rawMat.startsWith('вольфрам')) matName = 'Вольфрамовый экран';
      else if (rawMat.startsWith('контейнер')) matName = 'Контейнер ТК-6 (Pb)';

      if (shieldMatch[2]) {
        const thickVal = shieldMatch[2].replace(',', '.');
        const rawUnit = (shieldMatch[3] || 'см').toLowerCase();
        const unitLabel = rawUnit.startsWith('мм') || rawUnit.startsWith('милли') ? 'мм' : 'см';
        parsedShielding = `${matName} ${thickVal} ${unitLabel}`;
      } else {
        // Дополнительный поиск толщины рядом со словом «экран»
        const extraThick = norm.match(/экран[а-я]*\s+(\d+(?:[.,]\d+)?)\s*(см|сантиметр[а-я]*|мм)/i);
        if (extraThick && extraThick[1]) {
          const unitLabel = extraThick[2].toLowerCase().startsWith('мм') ? 'мм' : 'см';
          parsedShielding = `${matName} ${extraThick[1].replace(',', '.')} ${unitLabel}`;
        } else {
          parsedShielding = matName;
        }
      }
    }

    const nowIso = new Date().toISOString();
    const entry: VoiceLogEntry = {
      id: `vlog-${Date.now()}-${this.logSequence++}`,
      timestamp: nowIso,
      elapsedSec: Number(snapshot.elapsedSec.toFixed(1)),
      location: parsedLocation,
      textNote: cleanNote,
      currentDoseRate: parsedDoseRate,
      activeShielding: parsedShielding
    };

    return entry;
  }

  /**
   * Подача короткого тактильного импульса gamepad.haptics[0].pulse(0.3, 50)
   * на левый контроллер при старте и успешном завершении распознавания фразы
   */
  public triggerControllerVoiceHaptic(intensity = 0.3, durationMs = 50): void {
    const session = this.options.getXRSession?.();
    if (!session || !session.inputSources) return;

    for (let i = 0; i < session.inputSources.length; i++) {
      const src = session.inputSources[i];
      // Приоритетно подаем импульс на левый контроллер (или любой активный, если определен один)
      if ((src.handedness === 'left' || session.inputSources.length === 1) && src.gamepad) {
        const gp = src.gamepad;

        // 1. Вызов по спецификации gamepad.haptics[0].pulse(0.3, 50)
        if (gp.haptics && gp.haptics.length > 0 && typeof gp.haptics[0]?.pulse === 'function') {
          try {
            void gp.haptics[0].pulse(intensity, durationMs);
            continue;
          } catch {
            // Переход к hapticActuators
          }
        }

        // 2. Стандартный WebXR Gamepad API: gamepad.hapticActuators[0].pulse(0.3, 50)
        if (gp.hapticActuators && gp.hapticActuators.length > 0) {
          try {
            void (
              gp.hapticActuators[0] as unknown as {
                pulse: (val: number, dur: number) => Promise<boolean> | void;
              }
            ).pulse(intensity, durationMs);
            continue;
          } catch {
            // Переход к vibrationActuator
          }
        }

        // 3. Fallback: Gamepad vibrationActuator ('dual-rumble')
        const vib = (
          gp as unknown as {
            vibrationActuator?: {
              playEffect?: (
                type: string,
                params: { duration: number; strongMagnitude: number; weakMagnitude: number }
              ) => void;
            };
          }
        ).vibrationActuator;
        if (vib && typeof vib.playEffect === 'function') {
          try {
            vib.playEffect('dual-rumble', {
              duration: durationMs,
              strongMagnitude: intensity,
              weakMagnitude: intensity
            });
          } catch {
            // Игнорируем ошибку неподдерживаемого геймпада
          }
        }
      }
    }
  }

  /**
   * Обновление уровня громкости микрофона и 3D-индикатора в цикле рендеринга (Zero Allocation)
   */
  public update(dt: number): void {
    // 1. Расчет реальной амплитуды звука с микрофона через Web Audio AnalyserNode
    if (this.isPushToTalkActive && this.analyserNode && this.pcmBuffer) {
      this.analyserNode.getByteTimeDomainData(this.pcmBuffer);
      let sumSquares = 0;
      const len = this.pcmBuffer.length;
      for (let i = 0; i < len; i++) {
        const centered = (this.pcmBuffer[i] - 128) / 128;
        sumSquares += centered * centered;
      }
      const rms = Math.sqrt(sumSquares / len);
      const targetVol = Math.min(1.0, rms * 4.2);
      this.volumeLevel += (targetVol - this.volumeLevel) * Math.min(1.0, dt * 14.0);
    } else if (this.isPushToTalkActive) {
      // Плавная пульсация при активном PTT, если прямой аудиопоток не подключен
      const wave = 0.35 + 0.25 * Math.sin(performance.now() * 0.01);
      const speechBoost = this.interimTranscript.length > 0 ? 0.35 : 0.0;
      this.volumeLevel = Math.min(1.0, wave + speechBoost);
    } else {
      this.volumeLevel *= Math.max(0, 1 - dt * 10.0);
      if (this.volumeLevel < 0.01) this.volumeLevel = 0;
    }

    // 2. Обновление 3D-индикатора микрофона и плавающего Toast-дисплея на левой кисти
    const latestToast = this.getLatestActiveToast();
    this.micIndicator3D.updateAnimation(
      dt,
      this.isPushToTalkActive,
      this.volumeLevel,
      this.mode,
      this.status === 'error'
    );
    this.micIndicator3D.renderToastFeed(
      this.isPushToTalkActive,
      this.interimTranscript,
      latestToast,
      this.volumeLevel,
      this.mode
    );
  }

  private pushToastItem(params: {
    kind: VoiceToastFeedItem['kind'];
    title: string;
    text: string;
    metaTag?: string;
  }): void {
    const item: VoiceToastFeedItem = {
      id: `vtoast-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date().toLocaleTimeString('ru-RU'),
      kind: params.kind,
      title: params.title,
      text: params.text,
      metaTag: params.metaTag,
      expiresAt: performance.now() + 6500
    };
    this.toastFeed.unshift(item);
    if (this.toastFeed.length > 15) {
      this.toastFeed.pop();
    }
    this.options.onToastFeedUpdate?.(this.toastFeed, item);
  }

  public getLatestActiveToast(): VoiceToastFeedItem | null {
    if (this.toastFeed.length === 0) return null;
    const top = this.toastFeed[0];
    return performance.now() < top.expiresAt ? top : null;
  }

  public getLogs(): ReadonlyArray<VoiceLogEntry> {
    return this.logs;
  }

  public getToastFeed(): ReadonlyArray<VoiceToastFeedItem> {
    return this.toastFeed;
  }

  public clearLogs(): void {
    this.logs.length = 0;
    this.notifyStateChange();
  }

  /**
   * Поиск голосовых заметок, привязанных к временному интервалу точки телеметрии графика D(t) и H(t)
   */
  public findVoiceNotesForTimeWindow(elapsedSec: number, halfWindowSec = 0.6): string {
    if (this.logs.length === 0) return '';
    const matched = this.logs.filter(l => Math.abs(l.elapsedSec - elapsedSec) <= halfWindowSec);
    if (matched.length === 0) return '';
    return matched
      .map(
        m =>
          `[${m.location} | ${m.currentDoseRate} мкЗв/ч | ${m.activeShielding}] ${m.textNote}`
      )
      .join(' || ');
  }

  private notifyStateChange(): void {
    this.options.onStateChange?.({
      status: this.status,
      isPushToTalkActive: this.isPushToTalkActive,
      mode: this.mode,
      interimTranscript: this.interimTranscript,
      volumeLevel: this.volumeLevel,
      isSpeechSupported: this.isSpeechSupported,
      isMicAvailable: this.isMicAvailable,
      errorMessage: this.errorMessage
    });
  }

  public dispose(): void {
    this.isPushToTalkActive = false;
    if (this.restartTimerId !== null) {
      window.clearTimeout(this.restartTimerId);
      this.restartTimerId = null;
    }
    if (this.recognition) {
      try {
        this.recognition.abort();
      } catch {
        // Игнорируем
      }
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(t => t.stop());
      this.mediaStream = null;
    }
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
  }
}
