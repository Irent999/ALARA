/**
 * postFx.ts — конвейер постобработки для ДЕСКТОПНОГО режима.
 *
 * Порядок проходов (HDR, линейное пространство):
 *   RenderPass (MSAA, HalfFloat) → GTAOPass (AO) → UnrealBloomPass → OutputPass (ACES + sRGB) → SMAAPass
 *
 * ВАЖНО про VR: EffectComposer не умеет рендерить в буфер WebXR-сессии (стерео, foveation и т.д.),
 * поэтому при renderer.xr.isPresenting класс автоматически вызывает обычный renderer.render().
 * В VR качество держится на: MSAA (antialias:true), окружении (IBL), тенях, aoMap/lightMap и ACES-тонмаппинге.
 *
 * GTAO (ground-truth AO) — современная замена SSAO: точнее в углах, меньше «ореолов».
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { QUALITY_PRESETS, type QualityPreset } from './qualityRenderer';

export interface PostFXOptions {
  preset?: QualityPreset;
  /** Сила свечения бликов */
  bloomStrength?: number;
  bloomRadius?: number;
  /**
   * Порог Bloom в HDR-линейных единицах. Значения ≥ 1.0 → светятся только пересвеченные
   * блики на металле/лампы, а не вся картинка. Мягкий порог: 0.85–1.0
   */
  bloomThreshold?: number;
  /** Радиус AO в метрах сцены */
  aoRadius?: number;
}

export class PostFX {
  public readonly composer: EffectComposer;
  public enabled = true;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private camera: THREE.Camera;

  private readonly renderPass: RenderPass;
  private readonly gtaoPass: GTAOPass;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly smaaPass: SMAAPass;

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly opts: PostFXOptions = {}
  ) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    const cfg = QUALITY_PRESETS[opts.preset ?? 'high'];

    // HalfFloat: HDR-значения не обрезаются до 1.0 → Bloom и ACES работают корректно.
    // samples — аппаратный MSAA прямо в рендер-таргете (убирает «лесенки» на тонких перилах).
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, {
      type: THREE.HalfFloatType,
      samples: cfg.msaaSamples
    });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    this.renderPass = new RenderPass(scene, camera);
    this.composer.addPass(this.renderPass);

    // --- AO ---
    this.gtaoPass = new GTAOPass(scene, camera, size.x, size.y);
    this.gtaoPass.output = GTAOPass.OUTPUT.Default;
    this.gtaoPass.updateGtaoMaterial({
      radius: opts.aoRadius ?? 0.35,
      distanceExponent: 1.5,
      thickness: 1.5,
      scale: 1.0,
      samples: cfg.ssaoSamples,
      distanceFallOff: 1.0,
      screenSpaceRadius: false
    });
    this.gtaoPass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      radiusExponent: 1,
      rings: 2,
      samples: 16
    });
    this.composer.addPass(this.gtaoPass);

    // --- Bloom ---
    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      opts.bloomStrength ?? 0.15,
      opts.bloomRadius ?? 0.4,
      opts.bloomThreshold ?? 1.8
    );
    this.composer.addPass(this.bloomPass);

    // --- Тон-маппинг (берётся из renderer.toneMapping / toneMappingExposure) + перевод в sRGB ---
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    // --- SMAA (после OutputPass: детектор границ должен видеть итоговые sRGB-цвета) ---
    this.smaaPass = new SMAAPass();
    this.composer.addPass(this.smaaPass);

    this.setPreset(opts.preset ?? 'high');
  }

  /** Переключение качества на лету */
  public setPreset(preset: QualityPreset): void {
    const cfg = QUALITY_PRESETS[preset];
    this.gtaoPass.enabled = cfg.ssao;
    this.bloomPass.enabled = cfg.bloom;
    this.smaaPass.enabled = cfg.smaa;

    for (const rt of [this.composer.renderTarget1, this.composer.renderTarget2]) {
      if (rt.samples !== cfg.msaaSamples) {
        rt.samples = cfg.msaaSamples;
        rt.dispose(); // пересоздастся с новым числом сэмплов
      }
    }
  }

  /** Быстрые переключатели для отладки / настроек */
  public setBloomEnabled(on: boolean): void {
    this.bloomPass.enabled = on;
  }

  public setAOEnabled(on: boolean): void {
    this.gtaoPass.enabled = on;
  }

  public get bloomEnabled(): boolean {
    return this.bloomPass.enabled;
  }

  public get aoEnabled(): boolean {
    return this.gtaoPass.enabled;
  }

  public setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.renderPass.camera = camera;
    this.gtaoPass.camera = camera;
  }

  /** Вызывать при resize окна (после renderer.setSize) */
  public setSize(width: number, height: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(width, height);
  }

  /**
   * Замена вызова renderer.render(scene, camera) в основном цикле.
   * В VR, при отключённом эффекте — обычный рендер.
   */
  public render(deltaSec: number): void {
    if (!this.enabled || this.renderer.xr.isPresenting) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.composer.render(deltaSec);
  }

  public dispose(): void {
    this.composer.dispose();
    this.gtaoPass.dispose();
    this.bloomPass.dispose();
    this.outputPass.dispose();
    this.smaaPass.dispose();
  }
}
