/**
 * Минималистичный 2D HUD (сворачиваемые тактические панели), инспектор /assembly.glb
 * и итоговый протокол разбора МЧС (Сценарий №4).
 * Правило WebGL-совместимости: строго без backdrop-blur-* и без animate-pulse.
 */

import React, { useRef, useState } from 'react';
import {
  Flame,
  Users,
  ShieldAlert,
  Upload,
  RotateCcw,
  CheckCircle2,
  Award,
  Timer,
  Bug,
  XCircle,
  Crosshair,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Truck,
  Navigation,
  Activity,
  HeartPulse,
  Lock
} from 'lucide-react';
import type { Scenario4HudSnapshot } from './config';

interface Scenario4HudProps {
  snapshot: Scenario4HudSnapshot;
  isHudVisible: boolean;
  onRestart: () => void;
  onRetryLoadGlb: () => void;
  onFocusModel: () => void;
  onSelectCustomGlbFile: (file: File) => void;
  onBoardOrExitVehicle: () => void;
  onStartAutopilot: (buildingIndex: number) => void;
  onCancelAutopilot: () => void;
}

export const Scenario4Hud: React.FC<Scenario4HudProps> = ({
  snapshot,
  isHudVisible,
  onRestart,
  onRetryLoadGlb,
  onFocusModel,
  onSelectCustomGlbFile,
  onBoardOrExitVehicle,
  onStartAutopilot,
  onCancelAutopilot
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);
  const [isMissionCollapsed, setIsMissionCollapsed] = useState(false);
  const [isVehicleCollapsed, setIsVehicleCollapsed] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      onSelectCustomGlbFile(file);
    }
    e.target.value = '';
  };

  const mins = Math.floor(snapshot.elapsedSec / 60);
  const secs = Math.floor(snapshot.elapsedSec % 60);
  const timeStr = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  const isFailed = snapshot.debrief?.outcome === 'FAILED';

  const { vehicle, emergencyOps } = snapshot;
  const hosePct =
    vehicle.maxHoseLengthM > 0
      ? Math.min(100, Math.round((vehicle.hoseLengthM / vehicle.maxHoseLengthM) * 100))
      : 0;
  const smokePct = Math.round(snapshot.smokeExposure01 * 100);

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept=".glb,.gltf"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Термическая виньетка при приближении к очагам */}
      {snapshot.thermalHeatLoad01 > 0.06 && (
        <div
          className="pointer-events-none fixed inset-0 z-10 transition-opacity duration-200"
          style={{
            opacity: Math.min(0.85, snapshot.thermalHeatLoad01 * 0.9),
            background:
              'radial-gradient(circle at center, rgba(251,146,60,0) 45%, rgba(234,88,12,0.38) 80%, rgba(185,28,28,0.68) 100%)'
          }}
        />
      )}

      {/* Индикатор асинхронной загрузки /assembly.glb */}
      {snapshot.isLoadingGlb && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/88 pointer-events-auto">
          <div className="w-96 max-w-[90vw] p-5 rounded-xl bg-slate-900 border border-sky-500/40 shadow-2xl space-y-3 text-slate-100">
            <div className="text-xs font-mono text-sky-400 uppercase tracking-wider">
              Сценарий №4 · Загрузка 3D-модели АЭС (.glb)
            </div>
            <div className="text-sm font-semibold">{snapshot.loadStatusRu}</div>
            <div className="w-full h-2.5 rounded bg-slate-800 overflow-hidden">
              <div
                className="h-full bg-sky-400 transition-all duration-150"
                style={{ width: `${Math.max(4, Math.min(100, snapshot.loadProgressPct))}%` }}
              />
            </div>
            <div className="text-right text-xs font-mono tabular-nums text-slate-400">
              {Math.round(snapshot.loadProgressPct)}%
            </div>
          </div>
        </div>
      )}

      {/* Явное сообщение об ошибке загрузки /assembly.glb */}
      {!snapshot.isLoadingGlb && snapshot.loadErrorRu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-950/90 p-4 pointer-events-auto">
          <div className="max-w-lg w-full p-5 rounded-xl bg-slate-900 border border-rose-500/60 shadow-2xl space-y-3.5 text-slate-100">
            <div className="flex items-center gap-2 text-rose-400 text-xs font-mono uppercase tracking-wider font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Ошибка загрузки 3D-модели АЭС (/assembly.glb)</span>
            </div>
            <div className="text-sm font-semibold text-white">
              Не удалось загрузить оригинальную модель АЭС через GLTFLoader.
            </div>
            <div className="p-3 rounded-lg bg-rose-950/50 border border-rose-500/40 text-xs font-mono text-rose-200 break-words">
              {snapshot.loadErrorRu}
            </div>
            <div className="text-xs text-slate-300 leading-relaxed">
              Поместите бинарный файл <code className="px-1 py-0.5 rounded bg-slate-800 text-sky-300">assembly.glb</code> в{' '}
              <code className="px-1 py-0.5 rounded bg-slate-800 text-sky-300">public/assembly.glb</code> и нажмите «Повторить», либо откройте локальный файл с диска.
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onRetryLoadGlb}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Повторить</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Выбрать локальный .glb</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Верхняя левая панель: Миссия, чек-лист угроз и инспектор графа .glb */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed top-14 left-3 z-30 pointer-events-none flex flex-col gap-1.5 w-[430px] max-w-[calc(100vw-24px)]">
          {isMissionCollapsed ? (
            <button
              type="button"
              onClick={() => setIsMissionCollapsed(false)}
              className="pointer-events-auto self-start px-3 py-1.5 rounded-lg bg-slate-950/92 border border-slate-700/85 hover:border-sky-500/60 shadow-lg flex items-center gap-2.5 text-[11px] font-mono tabular-nums text-slate-200 cursor-pointer"
              title="Развернуть панель задач Сценария №4"
            >
              <span className="text-sky-300 font-bold whitespace-nowrap">
                ФАЗА {snapshot.stepNumber}/{snapshot.totalSteps}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-orange-300 whitespace-nowrap">
                Очаги {snapshot.firesExtinguished}/{snapshot.totalFires}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-300 whitespace-nowrap">
                Эвак. {snapshot.rescuedCount}/{snapshot.totalNpcCount}
              </span>
              <span className="text-slate-500">·</span>
              <span className="text-slate-400 whitespace-nowrap">{timeStr}</span>
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ) : (
            <div className="pointer-events-auto px-3 py-2 rounded-lg bg-slate-950/92 border border-slate-700/85 shadow-lg space-y-1.5">
              {/* Заголовок и кнопка сворачивания */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-sky-300 font-bold truncate">
                  ФАЗА {snapshot.stepNumber}/{snapshot.totalSteps} · {snapshot.stepTitleRu}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-slate-400 flex items-center gap-1 tabular-nums whitespace-nowrap">
                    <Timer className="w-3 h-3" />
                    {timeStr}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMissionCollapsed(true)}
                    className="p-0.5 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    title="Свернуть панель задач"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-xs text-slate-100 leading-snug">{snapshot.instructionRu}</div>

              {/* Основные показатели: очаги, персонал, ОУ-5/рукав, дым */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 border-t border-slate-800/90 text-[11px] font-mono tabular-nums">
                <span className="flex items-center gap-1 text-orange-300 whitespace-nowrap">
                  <Flame className="w-3.5 h-3.5" />
                  {snapshot.firesExtinguished}/{snapshot.totalFires}
                </span>
                <span className="flex items-center gap-1 text-emerald-300 whitespace-nowrap">
                  <Users className="w-3.5 h-3.5" />
                  {snapshot.rescuedCount}/{snapshot.totalNpcCount}
                </span>
                {vehicle.isHoseAttached ? (
                  <span className="text-sky-300 font-semibold whitespace-nowrap">
                    ГМ-70: рукав {vehicle.hoseLengthM.toFixed(0)} м
                  </span>
                ) : (
                  <span
                    className={`whitespace-nowrap ${
                      snapshot.extinguisherStatus === 'EMPTY'
                        ? 'text-rose-400 font-bold'
                        : snapshot.extinguisherLifecycleState === 'STOWED'
                        ? 'text-slate-300'
                        : snapshot.extinguisherStatus === 'ARMED'
                        ? 'text-cyan-300'
                        : 'text-amber-300'
                    }`}
                  >
                    ОУ-5:{' '}
                    {snapshot.extinguisherStatus === 'ON_POST'
                      ? 'на посту'
                      : snapshot.extinguisherStatus === 'HELD_LOCKED'
                      ? `${snapshot.extinguisherChargePct}% [чека!]`
                      : snapshot.extinguisherStatus === 'EMPTY'
                      ? 'ПУСТ'
                      : snapshot.extinguisherLifecycleState === 'STOWED'
                      ? `${snapshot.extinguisherChargePct}% (убр.)`
                      : `${snapshot.extinguisherChargePct}%`}
                  </span>
                )}
                {smokePct > 4 && (
                  <span
                    className={`whitespace-nowrap ${
                      smokePct >= 45 ? 'text-amber-300' : 'text-slate-400'
                    }`}
                  >
                    Дым: {smokePct}%
                  </span>
                )}
              </div>

              {/* Чек-лист аварийных угроз МЧС */}
              <div className="grid grid-cols-3 gap-1.5 pt-1 border-t border-slate-800/80 text-[10px] font-mono tabular-nums">
                <div
                  className={`px-2 py-1 rounded border flex items-center gap-1 truncate ${
                    emergencyOps.radReconDone
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900 border-slate-700/80 text-slate-300'
                  }`}
                >
                  <Activity className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {emergencyOps.radReconDone
                      ? 'Доразв.: ОК'
                      : `Доразв.: ${Math.round(emergencyOps.radReconProgress01 * 100)}%`}
                  </span>
                </div>

                <div
                  className={`px-2 py-1 rounded border flex items-center gap-1 truncate ${
                    emergencyOps.loopIsolated
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900 border-amber-500/35 text-amber-200'
                  }`}
                >
                  <Lock className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {emergencyOps.loopIsolated ? 'Контур: -65%' : 'Контур: откр.'}
                  </span>
                </div>

                <div
                  className={`px-2 py-1 rounded border flex items-center gap-1 truncate ${
                    emergencyOps.casualtyStabilized
                      ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-900 border-rose-500/35 text-rose-200'
                  }`}
                >
                  <HeartPulse className="w-3 h-3 shrink-0" />
                  <span className="truncate">
                    {emergencyOps.casualtyStabilized ? 'Постр.: спас.' : 'Постр.: ждёт'}
                  </span>
                </div>
              </div>

              {/* Служебные кнопки и подсказка управления */}
              <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-800/80 text-[10px] font-mono">
                <span className="text-slate-400 truncate">{snapshot.activeInputLabelRu}</span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onFocusModel}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-emerald-300 border border-slate-700 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    title="Центрировать камеру на Box3 модели [K]"
                  >
                    <Crosshair className="w-3 h-3" />
                    <span>[K]</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsInspectorOpen(v => !v)}
                    className={`px-2 py-0.5 rounded border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                      isInspectorOpen
                        ? 'bg-sky-900/70 border-sky-500/60 text-sky-200'
                        : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
                    }`}
                    title="Диагностика узлов и оборудования /assembly.glb"
                  >
                    <Bug className="w-3 h-3" />
                    <span>Узлы</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 border border-slate-700 flex items-center gap-1 cursor-pointer whitespace-nowrap"
                    title="Загрузить локальный .glb-файл комплекса АЭС"
                  >
                    <Upload className="w-3 h-3" />
                    <span>.GLB</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Раскрываемый инспектор графа .glb */}
          {isInspectorOpen && !isMissionCollapsed && snapshot.inspectionReport && (
            <div className="pointer-events-auto p-3 rounded-lg bg-slate-950/95 border border-slate-700 text-[11px] font-mono text-slate-200 space-y-1.5 shadow-xl max-h-60 overflow-y-auto">
              <div className="flex items-center justify-between text-sky-300 font-bold">
                <span>Инспектор графа АЭС ({snapshot.inspectionReport.sourceKind})</span>
                <span className="tabular-nums">{snapshot.inspectionReport.boundingBoxSize.join('×')} м</span>
              </div>
              <div className="text-slate-400 break-all">
                Источник: {snapshot.inspectionReport.sourceUrl}
              </div>
              <div className="text-slate-300 tabular-nums">
                Box3: до {snapshot.inspectionReport.rawBoundingBoxSize.join('×')} → после{' '}
                {snapshot.inspectionReport.boundingBoxSize.join('×')} м
              </div>
              <div className="text-slate-300 tabular-nums">
                Поворот: [{snapshot.inspectionReport.appliedRotationDeg.join('°, ')}°] · Масштаб: ×
                {snapshot.inspectionReport.appliedScale.toFixed(3)} · Настил Y:{' '}
                {snapshot.inspectionReport.deckSurfaceY} м
              </div>
              <div className="text-slate-400 tabular-nums">
                Узлов: {snapshot.inspectionReport.totalNodes} · Мешей:{' '}
                {snapshot.inspectionReport.totalMeshes} · Оборудование в корпусах:{' '}
                <span className="text-emerald-300 font-semibold">
                  {snapshot.installedEquipmentCount} узлов
                </span>
              </div>
              {snapshot.inspectionReport.buildingVolumes.length > 0 && (
                <div className="pt-1 border-t border-slate-800 text-slate-300 space-y-0.5">
                  <div className="text-emerald-300 font-bold">
                    Корпуса ({snapshot.inspectionReport.buildingVolumes.length}):
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5 tabular-nums">
                    {snapshot.inspectionReport.buildingVolumes.map((b, idx) => (
                      <div key={idx} className="truncate">
                        • {b.name}: {b.size.join('×')} м · пол Y={b.interiorFloorY} м
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {snapshot.inspectionReport.namedNodeCoords.length > 0 && (
                <div className="pt-1 border-t border-slate-800 text-slate-300 space-y-0.5">
                  <div className="text-sky-300 font-bold">
                    Узлы ({snapshot.inspectionReport.namedNodeCoords.length}):
                  </div>
                  <div className="text-[10px] text-slate-400 space-y-0.5 tabular-nums">
                    {snapshot.inspectionReport.namedNodeCoords.slice(0, 14).map((node, idx) => (
                      <div key={idx} className="truncate">
                        • {node.name} [{node.kind}]: [{node.worldPosition.join(', ')}]
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Контекстная подсказка и предупреждения (видны всегда при активности) */}
          {snapshot.targetPromptRu && (
            <div className="px-3 py-1.5 rounded-lg bg-sky-950/92 border border-sky-400/60 text-xs text-sky-100 font-medium shadow">
              {snapshot.targetPromptRu}
            </div>
          )}

          {snapshot.warningBannerRu && (
            <div className="px-3 py-2 rounded-lg bg-rose-950/95 border border-rose-500 text-xs text-rose-100 font-semibold flex items-center gap-2 shadow-lg">
              <ShieldAlert className="w-4 h-4 text-rose-400 shrink-0" />
              <span>{snapshot.warningBannerRu}</span>
            </div>
          )}
        </div>
      )}

      {/* Нижняя левая сворачиваемая панель: Пожарная техника МЧС (АЦ-40) и пожарный рукав */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed bottom-16 left-3 z-30 pointer-events-none w-[345px] max-w-[calc(100vw-24px)]">
          {isVehicleCollapsed ? (
            <button
              type="button"
              onClick={() => setIsVehicleCollapsed(false)}
              className="pointer-events-auto px-3 py-1.5 rounded-lg bg-slate-950/92 border border-slate-700/85 hover:border-amber-500/60 shadow-lg flex items-center gap-2 text-[11px] font-mono tabular-nums text-slate-200 cursor-pointer"
              title="Развернуть панель техники АЦ-40 и рукава"
            >
              <Truck className="w-3.5 h-3.5 text-rose-400 shrink-0" />
              <span className="font-bold text-slate-100 whitespace-nowrap">АЦ-40</span>
              <span className="text-slate-500">·</span>
              <span className={vehicle.isSeated ? 'text-emerald-300' : 'text-slate-300'}>
                {vehicle.isSeated ? `${vehicle.speedKmh} км/ч` : 'внешн.'}
              </span>
              <span className="text-slate-500">·</span>
              <span className={vehicle.isHoseAttached ? 'text-sky-300' : 'text-slate-400'}>
                Рукав {vehicle.hoseLengthM.toFixed(0)}/{vehicle.maxHoseLengthM}м
              </span>
              <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            </button>
          ) : (
            <div className="pointer-events-auto px-3 py-2 rounded-lg bg-slate-950/92 border border-slate-700/85 shadow-lg space-y-2 text-[11px] font-mono">
              {/* Шапка блока техники */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-slate-100 font-bold truncate">
                  <Truck className="w-3.5 h-3.5 text-rose-400 shrink-0" />
                  <span className="truncate">АЦ-40 МЧС</span>
                  <span className="text-slate-500">·</span>
                  <span
                    className={`tabular-nums ${
                      vehicle.isSeated ? 'text-emerald-300' : 'text-slate-400'
                    }`}
                  >
                    {vehicle.isSeated ? `${vehicle.speedKmh} км/ч` : vehicle.nearDoor ? 'у двери' : 'на стоянке'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={onBoardOrExitVehicle}
                    className={`px-2 py-0.5 rounded border text-[10px] font-bold cursor-pointer whitespace-nowrap ${
                      vehicle.isSeated
                        ? 'bg-rose-900/70 hover:bg-rose-800/80 border-rose-500/60 text-rose-100'
                        : vehicle.nearDoor
                        ? 'bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-slate-950'
                        : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300'
                    }`}
                    title="Посадка / выход из кабины АЦ-40 [Enter]"
                  >
                    {vehicle.isSeated ? 'Выйти [Enter]' : 'В кабину [Enter]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsVehicleCollapsed(true)}
                    className="p-0.5 rounded bg-slate-800/90 hover:bg-slate-700 text-slate-300 border border-slate-700 cursor-pointer"
                    title="Свернуть панель техники"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Автопилот перемещения между корпусами АЭС */}
              {vehicle.targets.length > 0 && (
                <div className="space-y-1 pt-1 border-t border-slate-800/85">
                  <div className="flex items-center justify-between text-[10px] text-slate-400">
                    <span className="flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-sky-400" />
                      <span>
                        {vehicle.autopilotTargetName
                          ? `Автопилот → ${vehicle.autopilotTargetName}`
                          : 'Автопилот к корпусам ([B]):'}
                      </span>
                    </span>
                    {vehicle.autopilotTargetName && (
                      <button
                        type="button"
                        onClick={onCancelAutopilot}
                        className="text-rose-300 hover:text-rose-200 underline cursor-pointer"
                      >
                        Стоп
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {vehicle.targets.slice(0, 4).map(t => {
                      const isActiveTarget = vehicle.autopilotTargetName === t.name;
                      return (
                        <button
                          key={t.index}
                          type="button"
                          onClick={() => onStartAutopilot(t.index)}
                          className={`px-2 py-0.5 rounded border text-[10px] tabular-nums cursor-pointer whitespace-nowrap ${
                            isActiveTarget
                              ? 'bg-sky-500/25 border-sky-400 text-sky-200 font-bold'
                              : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300'
                          }`}
                          title={`Направить АЦ-40 к «${t.name}» (${t.distanceM} м)`}
                        >
                          {t.name.replace(/^Корпус\s*/i, 'Корп. ')} · {t.distanceM}м
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Индикатор длины пожарного рукава */}
              <div className="space-y-1 pt-1 border-t border-slate-800/85">
                <div className="flex items-center justify-between text-[10px] tabular-nums">
                  <span
                    className={
                      vehicle.hoseOverstretched
                        ? 'text-amber-300 font-bold'
                        : vehicle.isHoseAttached
                        ? 'text-sky-300'
                        : 'text-slate-400'
                    }
                  >
                    Пожарный рукав {vehicle.isHoseAttached ? '(подключён)' : '(на катушке)'}
                  </span>
                  <span className="text-slate-200">
                    {vehicle.hoseLengthM.toFixed(1)} / {vehicle.maxHoseLengthM} м
                  </span>
                </div>
                <div className="w-full h-1.5 rounded bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      vehicle.hoseOverstretched
                        ? 'bg-amber-400'
                        : vehicle.isHoseAttached
                        ? 'bg-sky-400'
                        : 'bg-slate-600'
                    }`}
                    style={{ width: `${vehicle.isHoseAttached ? Math.max(4, hosePct) : 0}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Финальный протокол разбора МЧС (COMPLETED / FAILED) */}
      {snapshot.debrief && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/88 p-4 pointer-events-auto">
          <div
            className={`max-w-2xl w-full rounded-xl bg-slate-900 border shadow-2xl p-6 space-y-4 text-slate-100 ${
              isFailed ? 'border-rose-500/60' : 'border-emerald-500/50'
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-800 pb-3">
              <div>
                <div
                  className={`text-xs font-mono uppercase tracking-wider flex items-center gap-1.5 ${
                    isFailed ? 'text-rose-400' : 'text-emerald-400'
                  }`}
                >
                  {isFailed ? (
                    <XCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  {isFailed
                    ? 'Операция МЧС на комплексе АЭС прервана'
                    : 'Операция МЧС на комплексе АЭС завершена'}
                </div>
                <h2 className="text-lg font-bold text-white mt-1">
                  Итоговый протокол разбора (Сценарий №4)
                </h2>
              </div>
              <div
                className={`px-3 py-1.5 rounded-lg border font-mono text-sm font-bold flex items-center gap-1.5 ${
                  isFailed
                    ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                    : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                }`}
              >
                <Award className="w-4 h-4" />
                <span>Класс {snapshot.debrief.grade}</span>
              </div>
            </div>

            <div
              className={`text-xs font-semibold border rounded-lg px-3.5 py-2 ${
                isFailed
                  ? 'text-rose-200 bg-rose-950/40 border-rose-500/40'
                  : 'text-emerald-300 bg-emerald-950/40 border-emerald-500/30'
              }`}
            >
              {snapshot.debrief.gradeLabelRu}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono tabular-nums">
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ВРЕМЯ ОПЕРАЦИИ</div>
                <div className="text-base font-bold text-white mt-0.5">{timeStr}</div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">СПАСЕНО ПЕРСОНАЛА</div>
                <div className="text-base font-bold text-emerald-300 mt-0.5">
                  {snapshot.debrief.rescuedCount} / {snapshot.debrief.totalNpcCount} чел.
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ПОТУШЕНО ОЧАГОВ</div>
                <div className="text-base font-bold text-orange-300 mt-0.5">
                  {snapshot.debrief.extinguishedFires} / {snapshot.debrief.totalFires}
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">СРЕДСТВА ТУШЕНИЯ</div>
                <div className="text-base font-bold text-sky-300 mt-0.5">
                  ОУ-5: {snapshot.debrief.remainingExtinguisherPct}% ({snapshot.debrief.cylindersUsed})
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ДОЗА ALARA</div>
                <div className="text-base font-bold text-amber-300 mt-0.5">
                  {(snapshot.debrief.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
                </div>
              </div>
              <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                <div className="text-[10px] text-slate-400">ПИК ТЕПЛОВОЙ НАГР.</div>
                <div className="text-base font-bold text-rose-300 mt-0.5">
                  {snapshot.debrief.peakHeatLoadPct}%
                </div>
              </div>
            </div>

            {/* Статус дополнительных аварийных операций и техники МЧС */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.radReconDone
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                Разведка ДП-5В: {snapshot.debrief.radReconDone ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.loopIsolated
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                Контур перекрыт: {snapshot.debrief.loopIsolated ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.casualtyStabilized
                    ? 'bg-emerald-950/35 border-emerald-500/40 text-emerald-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                Медпомощь: {snapshot.debrief.casualtyStabilized ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-lg border ${
                  snapshot.debrief.usedHoseOrVehicle
                    ? 'bg-sky-950/35 border-sky-500/40 text-sky-300'
                    : 'bg-slate-950 border-slate-800 text-slate-400'
                }`}
              >
                АЦ-40 / Рукав: {snapshot.debrief.usedHoseOrVehicle ? 'ПРИМЕНЕНО' : 'НЕТ'}
              </div>
            </div>

            {snapshot.debrief.safetyErrors.length > 0 ? (
              <div className="p-3 rounded-lg bg-rose-950/35 border border-rose-500/40 text-xs space-y-1">
                <div className="font-bold text-rose-300">
                  Замечания по безопасности ({snapshot.debrief.safetyErrors.length}):
                </div>
                <ul className="list-disc list-inside text-rose-200 space-y-0.5">
                  {snapshot.debrief.safetyErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 rounded-lg bg-emerald-950/25 border border-emerald-500/30 text-xs text-emerald-200">
                Нарушений правил пожарной и радиационной безопасности МЧС не зафиксировано.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Загрузить .glb</span>
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Пройти сценарий заново</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
