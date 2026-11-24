/**
 * ALARA-Planner Pro VR - Аудиосистема радиационных детекторов (Web Audio API)
 * Синтезирует звук в реальном времени без внешних файлов для 100% автономности в Electron/Desktop.
 */

import { InstrumentProfile } from '../instruments/gostInstruments';

export class RadiationAudioEngine {
  private ctx: AudioContext | null = null;
  private isInitialized = false;
  private isMuted = false;
  private continuousOsc: OscillatorNode | null = null;
  private continuousGain: GainNode | null = null;

  public init(): void {
    if (this.isInitialized) return;
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AudioCtx();
      this.isInitialized = true;
    } catch {
      console.warn('Web Audio API not supported in current environment.');
    }
  }

  public setMuted(muted: boolean): void {
    this.isMuted = muted;
    if (this.continuousGain) {
      this.continuousGain.gain.setValueAtTime(0, this.ctx?.currentTime || 0);
    }
  }

  public toggleMute(): boolean {
    this.setMuted(!this.isMuted);
    return this.isMuted;
  }

  public getMuted(): boolean {
    return this.isMuted;
  }

  /**
   * Обновление аудиосигнала в цикле рендеринга на основе выбранного прибора, мощности дозы
   * и множителя учащенного треска при достижении 80% порога предупреждения (audioCrackleMultiplier)
   */
  public updateAudio(
    doseRateMicroSvPerHour: number,
    instrument: InstrumentProfile,
    deltaTime: number,
    audioCrackleMultiplier = 1.0
  ): void {
    if (this.isMuted || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const mult = Math.max(0.5, Math.min(6.5, audioCrackleMultiplier));
    const effectiveRate = doseRateMicroSvPerHour * mult;

    switch (instrument.audioStyle) {
      case 'geiger_clicks':
        this.stopContinuous();
        // Вероятность щелчка в текущем кадре зависит от мощности дозы и множителя предупреждения 80%
        const clicksPerSec = Math.max(
          mult > 1.2 ? 6.5 : 0.3,
          Math.min(750, effectiveRate * 0.45 + (mult > 1.2 ? 12.0 : 0.0))
        );
        const clickProb = clicksPerSec * deltaTime;
        if (Math.random() < clickProb) {
          this.playGeigerClick();
        }
        break;

      case 'scintillator_tone':
        this.stopContinuous();
        // Сцинтиллятор NaI(Tl) издает звуковые трели / импульсы высокой частоты
        const pulseRate = Math.max(
          mult > 1.2 ? 14 : 2,
          Math.min(1400, effectiveRate * 1.8)
        );
        if (Math.random() < pulseRate * deltaTime) {
          this.playScintillatorChirp(effectiveRate);
        }
        break;

      case 'ion_buzzer':
        // Ионизационная камера: непрерывный или мерный низкий гул, переходящий в зуммер
        if (effectiveRate > 50 || mult > 1.5) {
          this.ensureContinuousOsc(Math.max(effectiveRate, mult > 1.5 ? 180 : 50));
        } else {
          this.stopContinuous();
          if (Math.random() < 0.05 * mult) this.playSoftBeep();
        }
        break;

      case 'neutron_pulse':
        this.stopContinuous();
        // Нейтронный рем-метр: глухие плотные удары
        const neutronClicks = Math.max(
          mult > 1.2 ? 4.5 : 0.1,
          Math.min(120, effectiveRate * 0.15 + (mult > 1.2 ? 6.0 : 0.0))
        );
        if (Math.random() < neutronClicks * deltaTime) {
          this.playNeutronThud();
        }
        break;
    }
  }

  private playGeigerClick(): void {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // Высокочастотный сухой щелчок
    osc.type = 'square';
    osc.frequency.setValueAtTime(1400 + Math.random() * 1200, this.ctx.currentTime);

    filter.type = 'highpass';
    filter.frequency.setValueAtTime(800, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.004);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.005);
  }

  private playScintillatorChirp(doseRate: number): void {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    const baseFreq = Math.min(3200, 800 + Math.log10(Math.max(1, doseRate)) * 600);
    osc.frequency.setValueAtTime(baseFreq, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.06, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.014);
  }

  private playNeutronThud(): void {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(160 + Math.random() * 40, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.12, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.035);
  }

  private playSoftBeep(): void {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(600, this.ctx.currentTime);

    const now = this.ctx.currentTime;
    gain.gain.setValueAtTime(0.03, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.04);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.045);
  }

  private ensureContinuousOsc(doseRate: number): void {
    if (!this.ctx || this.isMuted) return;
    if (!this.continuousOsc) {
      this.continuousOsc = this.ctx.createOscillator();
      this.continuousGain = this.ctx.createGain();
      this.continuousOsc.type = 'sawtooth';
      this.continuousGain.gain.setValueAtTime(0.01, this.ctx.currentTime);
      this.continuousOsc.connect(this.continuousGain);
      this.continuousGain.connect(this.ctx.destination);
      this.continuousOsc.start();
    }

    const freq = Math.min(1800, 300 + Math.min(1200, doseRate * 0.4));
    this.continuousOsc.frequency.setTargetAtTime(freq, this.ctx.currentTime, 0.05);
    const targetVol = Math.min(0.06, 0.01 + (doseRate / 2000) * 0.04);
    this.continuousGain?.gain.setTargetAtTime(targetVol, this.ctx.currentTime, 0.05);
  }

  private stopContinuous(): void {
    if (this.continuousOsc) {
      try {
        this.continuousOsc.stop();
        this.continuousOsc.disconnect();
      } catch {}
      this.continuousOsc = null;
      this.continuousGain = null;
    }
  }

  public playAlarmSiren(): void {
    if (!this.ctx || this.isMuted) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = 'sawtooth';
    const now = this.ctx.currentTime;
    osc.frequency.setValueAtTime(800, now);
    osc.frequency.linearRampToValueAtTime(1400, now + 0.15);
    osc.frequency.linearRampToValueAtTime(800, now + 0.3);

    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + 0.36);
  }

  /**
   * Предупреждающий звуковой сигнал тревоги (двойной импульс) при приближении к порогу 80%
   */
  public playEarlyWarningChirp(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(920, now);
      osc.frequency.linearRampToValueAtTime(1380, now + 0.1);
      osc.frequency.linearRampToValueAtTime(920, now + 0.2);

      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.29);
    } catch {}
  }

  /**
   * Звуковая пульсация прибора в Желтой зоне (периодический мерный сигнал порога дозиметра)
   */
  public playYellowZonePulse(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, now); // Ля второй октавы
      osc.frequency.setValueAtTime(1174, now + 0.08); // Ре третьей октавы

      gain.gain.setValueAtTime(0.065, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.18);
    } catch {}
  }

  /**
   * Непрерывный аварийный сигнал в Красной зоне (экстренное отступление)
   */
  public playRedZoneAlarm(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(1400, now);
      osc.frequency.linearRampToValueAtTime(850, now + 0.12);

      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.15);
    } catch {}
  }

  public playBreakerSwitch(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.exponentialRampToValueAtTime(75, now + 0.07);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.09);
    } catch {}
  }

  public playDieselGeneratorStart(): void {
    if (!this.ctx || this.isMuted) return;
    try {
      const now = this.ctx.currentTime;
      const osc = this.ctx.createOscillator();
      const filter = this.ctx.createBiquadFilter();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(38, now);
      osc.frequency.exponentialRampToValueAtTime(68, now + 0.45);
      osc.frequency.linearRampToValueAtTime(58, now + 0.9);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(240, now);

      gain.gain.setValueAtTime(0.01, now);
      gain.gain.linearRampToValueAtTime(0.11, now + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.95);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.ctx.destination);
      osc.start(now);
      osc.stop(now + 0.98);
    } catch {}
  }

  public playTaskSuccess(): void {
    if (!this.ctx || this.isMuted) return;
    const now = this.ctx.currentTime;
    [523.25, 659.25, 783.99, 1046.50].forEach((freq, idx) => {
      const osc = this.ctx!.createOscillator();
      const gain = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.08);

      gain.gain.setValueAtTime(0.06, now + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + idx * 0.08 + 0.25);

      osc.connect(gain);
      gain.connect(this.ctx!.destination);

      osc.start(now + idx * 0.08);
      osc.stop(now + idx * 0.08 + 0.26);
    });
  }

  public dispose(): void {
    this.stopContinuous();
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
  }
}
