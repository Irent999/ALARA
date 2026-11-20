/**
 * contaminationScanner.js — тепловая карта α/β-загрязнения поверхностей (Three.js r160+, WebXR).
 *
 * Принцип: стандартные PBR-материалы стен/полов/оборудования патчатся через onBeforeCompile.
 * Оверлей считается во фрагментном шейдере по мировым координатам пикселя и массиву
 * «горячих пятен» (uniform vec4[16]). Никаких постпроцессинг-проходов, render target'ов
 * и дополнительных draw call'ов: стоимость — один цикл ≤16 итераций на пиксель
 * и только когда сканер включён (uniform-ветка пропускает код целиком при reveal = 0).
 *
 * Все патченные материалы делят ОДИН набор uniform-объектов => обновление раз в кадр
 * стоит O(1) независимо от числа мешей.
 */
import * as THREE from 'three';

export const MAX_CONTAMINATION_SPOTS = 16;

/** Режимы отображения */
export const ScanMode = Object.freeze({ COMBINED: 0, ALPHA: 1, BETA: 2 });

/* ------------------------------------------------------------------ */
/*  GLSL                                                              */
/* ------------------------------------------------------------------ */

const VERT_DECL = /* glsl */ `
varying highp vec3 vContamWorldPos;
`;

// Вставляется после <project_vertex>: transformed уже содержит skinning/morph.
const VERT_BODY = /* glsl */ `
#include <project_vertex>
{
  vec4 contamLocal = vec4( transformed, 1.0 );
  #ifdef USE_INSTANCING
    contamLocal = instanceMatrix * contamLocal;
  #endif
  vContamWorldPos = ( modelMatrix * contamLocal ).xyz;
}
`;

const FRAG_DECL = /* glsl */ `
#define MAX_CONTAM_SPOTS ${MAX_CONTAMINATION_SPOTS}
varying highp vec3 vContamWorldPos;
uniform float uContamReveal;      // 0..1 плавное включение
uniform float uContamTime;
uniform float uContamOpacity;
uniform int   uContamCount;
uniform int   uContamMode;        // 0 = α+β, 1 = α, 2 = β
uniform vec4  uContamProbe;       // xyz = позиция сканера, w = дальность (0 = без ограничения)
uniform vec4  uContamPos[MAX_CONTAM_SPOTS]; // xyz = центр (мир), w = 1 / radius²
uniform vec2  uContamAct[MAX_CONTAM_SPOTS]; // x = α-уровень 0..1, y = β-уровень 0..1

vec3 contamRamp( float t ) {
  // синий -> бирюзовый -> зелёный -> жёлтый -> красный
  float x = clamp( t, 0.0, 1.0 ) * 4.0;
  vec3 c = vec3( 0.04, 0.16, 0.90 );
  c = mix( c, vec3( 0.00, 0.80, 0.75 ), clamp( x,       0.0, 1.0 ) );
  c = mix( c, vec3( 0.25, 0.90, 0.15 ), clamp( x - 1.0, 0.0, 1.0 ) );
  c = mix( c, vec3( 1.00, 0.85, 0.00 ), clamp( x - 2.0, 0.0, 1.0 ) );
  c = mix( c, vec3( 1.00, 0.10, 0.02 ), clamp( x - 3.0, 0.0, 1.0 ) );
  return c;
}

float contamLevel( vec3 p ) {
  float a = 0.0;
  float b = 0.0;
  for ( int i = 0; i < MAX_CONTAM_SPOTS; i++ ) {
    if ( i >= uContamCount ) break;
    vec3 d = p - uContamPos[ i ].xyz;
    float q = dot( d, d ) * uContamPos[ i ].w;   // (dist/R)²
    if ( q < 1.0 ) {
      float k = 1.0 - q;
      k *= k;                                     // компактное гладкое ядро, без exp()
      a += uContamAct[ i ].x * k;
      b += uContamAct[ i ].y * k;
    }
  }
  if ( uContamMode == 1 ) return clamp( a, 0.0, 1.0 );
  if ( uContamMode == 2 ) return clamp( b, 0.0, 1.0 );
  return clamp( a + b, 0.0, 1.0 );
}
`;

// Вставляется перед <opaque_fragment>: после PBR-освещения, до записи gl_FragColor.
const FRAG_BODY = /* glsl */ `
if ( uContamReveal > 0.001 ) {
  float level = contamLevel( vContamWorldPos );

  float range = 1.0;
  if ( uContamProbe.w > 0.0 ) {
    float dp = distance( vContamWorldPos, uContamProbe.xyz );
    range = 1.0 - smoothstep( uContamProbe.w * 0.6, uContamProbe.w, dp );
  }

  vec3  heat  = contamRamp( level );
  float pulse = 1.0 + 0.12 * sin( uContamTime * 6.0 - level * 9.0 ) * step( 0.5, level );
  // 0.18 — «холодный» фон по всей поверхности, до 0.85 — горячее ядро
  float alpha = mix( 0.18, 0.85, smoothstep( 0.0, 0.35, level ) ) * uContamOpacity * uContamReveal * range;

  outgoingLight = mix( outgoingLight, heat, alpha );
  outgoingLight += heat * ( level * level * 0.55 * pulse ) * uContamReveal * range; // свечение ядра
}
#include <opaque_fragment>
`;

/* ------------------------------------------------------------------ */
/*  Менеджер                                                          */
/* ------------------------------------------------------------------ */

export class ContaminationScanManager {
  /**
   * @param {object} [opts]
   * @param {THREE.WebGLRenderer} [opts.renderer]  нужен только для встроенного опроса кнопок
   * @param {number}  [opts.opacity=1]
   * @param {number}  [opts.probeRange=0]   >0: оверлей виден лишь в радиусе (м) от сканера
   * @param {number}  [opts.fadeSpeed=6]    скорость плавного вкл/выкл (1/с)
   * @param {null|{handedness:'left'|'right', buttonIndex:number}} [opts.controls]
   *        Встроенный опрос кнопки. По умолчанию правая A (buttons[4]).
   *        Передайте null, если переключение вызывается снаружи (VRInputManager).
   * @param {(active:boolean)=>void} [opts.onToggle]
   */
  constructor(opts = {}) {
    this.renderer = opts.renderer ?? null;
    this.fadeSpeed = opts.fadeSpeed ?? 6;
    this.onToggle = opts.onToggle ?? null;
    this.controls = opts.controls === undefined
      ? { handedness: 'right', buttonIndex: 4 }
      : opts.controls;

    this.active = false;
    this._reveal = 0;
    this._wasPressed = false;
    this._warned = false;

    this._spotPos = Array.from({ length: MAX_CONTAMINATION_SPOTS }, () => new THREE.Vector4(0, 0, 0, 1));
    this._spotAct = Array.from({ length: MAX_CONTAMINATION_SPOTS }, () => new THREE.Vector2());
    this._spotRadius = new Float32Array(MAX_CONTAMINATION_SPOTS); // для CPU-сэмплинга
    this._count = 0;

    /** Общие uniform'ы: ссылки раздаются всем патченным материалам. */
    this.uniforms = {
      uContamReveal: { value: 0 },
      uContamTime: { value: 0 },
      uContamOpacity: { value: opts.opacity ?? 1 },
      uContamCount: { value: 0 },
      uContamMode: { value: ScanMode.COMBINED },
      uContamProbe: { value: new THREE.Vector4(0, 0, 0, opts.probeRange ?? 0) },
      uContamPos: { value: this._spotPos },
      uContamAct: { value: this._spotAct },
    };

    this._patched = new WeakSet();
    this._tmp = new THREE.Vector3();
  }

  /* ---------------- патчинг материалов ---------------- */

  /**
   * Патчит все подходящие материалы в иерархии.
   * @param {THREE.Object3D} root
   * @param {(mesh:THREE.Mesh, mat:THREE.Material)=>boolean} [filter]  true = патчить
   */
  registerObject(root, filter) {
    root.traverse((o) => {
      if (!o.isMesh && !o.isInstancedMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) if (m && (!filter || filter(o, m))) this.registerMaterial(m);
    });
  }

  /** Патчит один материал (Standard / Physical / Lambert / Phong / Basic). */
  registerMaterial(material) {
    if (this._patched.has(material)) return;
    if (!material.isMeshStandardMaterial && !material.isMeshLambertMaterial &&
        !material.isMeshPhongMaterial && !material.isMeshBasicMaterial) return;
    if (material.transparent || material.userData?.noContamination) return;

    const prev = material.onBeforeCompile;
    const uniforms = this.uniforms;

    material.onBeforeCompile = function (shader, renderer) {
      if (prev) prev.call(this, shader, renderer);
      Object.assign(shader.uniforms, uniforms); // общие ссылки, не копии

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\n' + VERT_DECL)
        .replace('#include <project_vertex>', VERT_BODY);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\n' + FRAG_DECL)
        .replace('#include <opaque_fragment>', FRAG_BODY);
    };
    // Уникальный ключ: патченная и обычная версии не должны делить программу.
    const prevKey = material.customProgramCacheKey?.bind(material);
    material.customProgramCacheKey = () => 'contam-v1|' + (prevKey ? prevKey() : '');
    material.needsUpdate = true;
    this._patched.add(material);
  }

  /* ---------------- данные загрязнения ---------------- */

  /**
   * Задать пятна загрязнения (не более MAX_CONTAMINATION_SPOTS, лишние отбрасываются).
   * @param {Array<{position:THREE.Vector3, radius?:number, alpha?:number, beta?:number}>} spots
   *        alpha/beta — нормированный уровень 0..1; radius — в метрах.
   */
  setSpots(spots) {
    if (spots.length > MAX_CONTAMINATION_SPOTS && !this._warned) {
      console.warn(`[ContaminationScan] пятен ${spots.length} > ${MAX_CONTAMINATION_SPOTS}; лишние отброшены`);
      this._warned = true;
    }
    const n = Math.min(spots.length, MAX_CONTAMINATION_SPOTS);
    for (let i = 0; i < n; i++) this._writeSpot(i, spots[i]);
    this._count = n;
    this.uniforms.uContamCount.value = n;
  }

  /** Обновить одно пятно без реаллокаций (например, пятно «растёт»). */
  updateSpot(i, spot) {
    if (i < 0 || i >= this._count) return;
    this._writeSpot(i, spot);
  }

  clearSpots() { this.setSpots([]); }

  _writeSpot(i, s) {
    const r = Math.max(0.05, s.radius ?? 0.8);
    this._spotPos[i].set(s.position.x, s.position.y, s.position.z, 1 / (r * r));
    this._spotAct[i].set(THREE.MathUtils.clamp(s.alpha ?? 0, 0, 1), THREE.MathUtils.clamp(s.beta ?? 0, 0, 1));
    this._spotRadius[i] = r;
  }

  /**
   * Хелпер: пятна из источников сценария (RadiationSourceInstance).
   * Уровень = log10(1 + МБк) / 4 (≈ 0..1 для 0..10 ГБк).
   * @param {Array<{position:THREE.Vector3, activityMBq:number, isotopeId:string}>} sources
   * @param {(src)=>{alpha?:number, beta?:number, radius?:number}} [classify]
   *        определить тип излучения; по умолчанию всё считается β.
   */
  setSpotsFromSources(sources, classify) {
    this.setSpots(sources.map((src) => {
      const level = THREE.MathUtils.clamp(Math.log10(1 + src.activityMBq) / 4, 0, 1);
      const c = classify?.(src) ?? { beta: level };
      return { position: src.position, radius: c.radius ?? 0.8, alpha: c.alpha ?? 0, beta: c.beta ?? 0 };
    }));
  }

  /**
   * CPU-версия того же ядра: уровень загрязнения (0..1) в мировой точке.
   * Для щупа/дозиметра: звук Гейгера, вибрация, HUD. Без аллокаций.
   */
  sampleLevel(worldPos, mode = this.uniforms.uContamMode.value) {
    let a = 0, b = 0;
    for (let i = 0; i < this._count; i++) {
      const p = this._spotPos[i];
      const dx = worldPos.x - p.x, dy = worldPos.y - p.y, dz = worldPos.z - p.z;
      const q = (dx * dx + dy * dy + dz * dz) * p.w;
      if (q < 1) { const k = (1 - q) * (1 - q); a += this._spotAct[i].x * k; b += this._spotAct[i].y * k; }
    }
    if (mode === ScanMode.ALPHA) return Math.min(a, 1);
    if (mode === ScanMode.BETA) return Math.min(b, 1);
    return Math.min(a + b, 1);
  }

  /* ---------------- управление ---------------- */

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    this.onToggle?.(on);
  }
  toggle() { this.setActive(!this.active); return this.active; }

  setMode(mode) { this.uniforms.uContamMode.value = mode; }
  cycleMode() {
    const m = (this.uniforms.uContamMode.value + 1) % 3;
    this.uniforms.uContamMode.value = m;
    return m;
  }
  setProbeRange(meters) { this.uniforms.uContamProbe.value.w = meters; }

  /**
   * Вызывать каждый кадр из renderer.setAnimationLoop.
   * @param {number} dt  секунды
   * @param {THREE.Vector3} [probeWorldPos]  позиция руки/щупа (для probeRange > 0)
   * @param {XRFrame} [frame]  не используется; оставлен для совместимости сигнатуры колбэка
   */
  update(dt, probeWorldPos) {
    if (this.controls && this.renderer?.xr.isPresenting) this._pollXRButton();

    const target = this.active ? 1 : 0;
    this._reveal += (target - this._reveal) * Math.min(1, dt * this.fadeSpeed);
    if (Math.abs(target - this._reveal) < 0.002) this._reveal = target;

    const u = this.uniforms;
    u.uContamReveal.value = this._reveal;
    if (this._reveal > 0) {
      u.uContamTime.value += dt;
      if (probeWorldPos) u.uContamProbe.value.set(probeWorldPos.x, probeWorldPos.y, probeWorldPos.z, u.uContamProbe.value.w);
    }
  }

  /** Встроенный опрос кнопки контроллера (детектор переднего фронта). */
  _pollXRButton() {
    const session = this.renderer.xr.getSession();
    if (!session) return;
    let pressed = false;
    let gp = null;
    for (const src of session.inputSources) {
      if (src.handedness !== this.controls.handedness || !src.gamepad) continue;
      const btn = src.gamepad.buttons[this.controls.buttonIndex];
      if (btn && (btn.pressed || btn.value > 0.5)) { pressed = true; gp = src.gamepad; }
    }
    if (pressed && !this._wasPressed) {
      this.toggle();
      try { gp?.hapticActuators?.[0]?.pulse?.(0.35, 45); } catch { /* ignore */ }
    }
    this._wasPressed = pressed;
  }

  dispose() {
    this.setActive(false);
    this._reveal = 0;
    this.uniforms.uContamReveal.value = 0;
    this._count = 0;
    this.uniforms.uContamCount.value = 0;
  }
}
