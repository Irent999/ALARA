/**
 * ALARA-Planner Pro — Модуль безопасности интерфейса в VR-шлеме (VR UI & 2D HUD Management)
 *
 * Реализует реактивный хук `useXR` / `useXRSessionState` и защитный контейнер `Desktop2DHUDOverlayGuard`.
 * Строгое правило безопасности VR:
 *   Если пользователь надевает VR-шлем (`isPresenting === true`), весь 2D HTML/DOM оверлей (HUD)
 *   ПОЛНОСТЬЮ исключается из дерева рендера React (`return null`).
 *   Все элементы управления, сигналы тревоги и статус оборудования переносятся в 3D Spatial UI
 *   (планшет спасателя VRUISystem, наручный голографический дисплей на запястье костюма и ЖК-экран дозиметра).
 */

import React, { useEffect, useState } from 'react';
import * as THREE from 'three';

export interface XRSessionState {
  /** Флаг активной презентации в VR-шлеме (WebXR immersive-vr session) */
  isPresenting: boolean;
  /** Текущая активная сессия WebXR (или null в Desktop-режиме) */
  session: XRSession | null;
}

/**
 * Хук `useXR` (совместимый по контракту с `@react-three/xr`), отслеживающий состояние
 * `isPresenting` напрямую из `THREE.WebGLRenderer.xr` и синхронизирующий React-состояние.
 */
export function useXR(
  rendererRef?: React.RefObject<THREE.WebGLRenderer | null>,
  externalIsPresenting: boolean = false
): XRSessionState {
  const [xrState, setXrState] = useState<XRSessionState>({
    isPresenting: externalIsPresenting,
    session: null
  });

  useEffect(() => {
    let activeRenderer: THREE.WebGLRenderer | null = rendererRef?.current ?? null;

    const syncFromRenderer = () => {
      if (!activeRenderer?.xr) {
        setXrState(prev =>
          prev.isPresenting === externalIsPresenting
            ? prev
            : { isPresenting: externalIsPresenting, session: null }
        );
        return;
      }
      const presenting = Boolean(activeRenderer.xr.isPresenting || externalIsPresenting);
      const currentSession = activeRenderer.xr.getSession?.() ?? null;
      setXrState(prev =>
        prev.isPresenting === presenting && prev.session === currentSession
          ? prev
          : { isPresenting: presenting, session: currentSession }
      );
    };

    if (activeRenderer?.xr) {
      syncFromRenderer();
      activeRenderer.xr.addEventListener('sessionstart', syncFromRenderer);
      activeRenderer.xr.addEventListener('sessionend', syncFromRenderer);
    } else {
      syncFromRenderer();
      // Ожидание готовности WebGLRenderer (если Three.js инициализируется асинхронно)
      const pollTimer = setInterval(() => {
        if (rendererRef?.current?.xr) {
          activeRenderer = rendererRef.current;
          clearInterval(pollTimer);
          syncFromRenderer();
          activeRenderer.xr.addEventListener('sessionstart', syncFromRenderer);
          activeRenderer.xr.addEventListener('sessionend', syncFromRenderer);
        }
      }, 200);

      return () => {
        clearInterval(pollTimer);
        if (activeRenderer?.xr) {
          activeRenderer.xr.removeEventListener('sessionstart', syncFromRenderer);
          activeRenderer.xr.removeEventListener('sessionend', syncFromRenderer);
        }
      };
    }

    return () => {
      if (activeRenderer?.xr) {
        activeRenderer.xr.removeEventListener('sessionstart', syncFromRenderer);
        activeRenderer.xr.removeEventListener('sessionend', syncFromRenderer);
      }
    };
  }, [rendererRef, externalIsPresenting]);

  return {
    isPresenting: Boolean(xrState.isPresenting || externalIsPresenting),
    session: xrState.session
  };
}

export interface Desktop2DHUDOverlayGuardProps {
  /** Состояние активной VR-сессии из `useXR()` */
  isPresenting: boolean;
  /** Дочерние 2D HTML/DOM компоненты (HUD, модальные окна, тосты), рендерящиеся только вне VR */
  children: React.ReactNode;
}

/**
 * Защитный компонент 2D-интерфейса:
 * При `isPresenting === true` возвращает строго `null`, полностью размонтируя 2D DOM-оверлей,
 * чтобы ни одно 2D-окно не перекрывало стереоскопический обзор в VR-шлеме.
 */
export const Desktop2DHUDOverlayGuard: React.FC<Desktop2DHUDOverlayGuardProps> = ({
  isPresenting,
  children
}) => {
  if (isPresenting) {
    return null;
  }
  return React.createElement(React.Fragment, null, children);
};
