/**
 * assetLoaders.ts — загрузчик GLB с поддержкой сжатия: Draco, Meshopt (геометрия) и KTX2 (текстуры).
 *
 * Зачем: «живая» комната — это десятки МБ геометрии и текстур. Сжатые GLB весят в 5–10 раз меньше
 * и занимают в видеопамяти в 4–6 раз меньше (KTX2 остаётся сжатым на GPU). Без этих декодеров
 * сжатый GLB просто не откроется.
 *
 * Нужны файлы декодеров в public/ (см. GRAPHICS_GUIDE.md, раздел «Декодеры»):
 *   public/draco/  ← node_modules/three/examples/jsm/libs/draco/gltf/*
 *   public/basis/  ← node_modules/three/examples/jsm/libs/basis/*
 */

import type * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

export function createGLTFLoader(
  renderer: THREE.WebGLRenderer,
  decoderBase = './' // относительно index.html; при base:'./' в vite.config это правильно и для dev, и для сборки
): GLTFLoader {
  const loader = new GLTFLoader();

  const draco = new DRACOLoader();
  draco.setDecoderPath(`${decoderBase}draco/`);
  loader.setDRACOLoader(draco);

  const ktx2 = new KTX2Loader();
  ktx2.setTranscoderPath(`${decoderBase}basis/`);
  ktx2.detectSupport(renderer);
  loader.setKTX2Loader(ktx2);

  loader.setMeshoptDecoder(MeshoptDecoder);
  return loader;
}
