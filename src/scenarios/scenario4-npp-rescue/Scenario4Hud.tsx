/**
 * Компактный сворачиваемый 2D HUD, сервисный инспектор /assembly.glb и итоговый разбор МЧС (Сценарий №4).
 * По умолчанию панели свёрнуты в аккуратные чипы, чтобы оставлять максимум 3D-обзора.
 * Правило WebGL-совместимости: строго без backdrop-blur-* и без animate-pulse.
 */

import React, { useRef, useState } from 'react';
import {
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
  ChevronRight,
  Truck,
  Navigation
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
  onToggleBeacons?: () => void;
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
  onCancelAutopilot,
  onToggleBeacons
}) => {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // По умолчанию обе боковые панели и блок сервисных кнопок свёрнуты, чтобы не перекрывать 3D-сцену
  const [isMissionCollapsed, setIsMissionCollapsed] = useState(true);
  const [isVehicleCollapsed, setIsVehicleCollapsed] = useState(true);
  const [isServiceToolsOpen, setIsServiceToolsOpen] = useState(false);
  const [isInspectorOpen, setIsInspectorOpen] = useState(false);

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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B1117]/85 backdrop-blur-sm pointer-events-auto">
          <div className="w-96 max-w-[90vw] p-5 rounded-xl alara-glass-elevated space-y-3">
            <div className="text-xs font-mono text-[#0EA5E9] tracking-wide">
              Сценарий №4 · Загрузка 3D-модели АЭС (.glb)
            </div>
            <div className="text-sm font-semibold text-[#F1F5F9]">{snapshot.loadStatusRu}</div>
            <div className="w-full h-2 rounded-full bg-slate-800/80 overflow-hidden">
              <div
                className="h-full bg-[#0EA5E9] transition-all duration-150"
                style={{ width: `${Math.max(4, Math.min(100, snapshot.loadProgressPct))}%` }}
              />
            </div>
            <div className="text-right text-xs font-mono alara-tabular text-[#94A3B8]">
              {Math.round(snapshot.loadProgressPct)}%
            </div>
          </div>
        </div>
      )}

      {/* Сообщение об ошибке загрузки /assembly.glb */}
      {!snapshot.isLoadingGlb && snapshot.loadErrorRu && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#0B1117]/85 backdrop-blur-sm p-4 pointer-events-auto">
          <div className="max-w-lg w-full p-5 rounded-xl alara-glass-elevated border-[#EF4444]/45 space-y-3.5">
            <div className="flex items-center gap-2 text-[#EF4444] text-xs font-mono font-bold">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>Ошибка загрузки 3D-модели АЭС (/assembly.glb)</span>
            </div>
            <div className="text-sm font-semibold text-[#F1F5F9]">
              Не удалось загрузить оригинальную модель АЭС через GLTFLoader.
            </div>
            <div className="p-3 rounded-[10px] alara-surface border-[#EF4444]/35 text-xs font-mono text-rose-200 break-words">
              {snapshot.loadErrorRu}
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={onRetryLoadGlb}
                className="px-4 py-2 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F1F5F9] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Повторить</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-[10px] bg-[#0EA5E9] hover:bg-sky-400 text-[#0B1117] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Выбрать локальный .glb</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ВЕРХНИЙ ЛЕВЫЙ УГОЛ: Сворачиваемый чип / карточка миссии и сервис */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed top-14 left-3 z-30 pointer-events-none flex flex-col gap-1.5 w-[360px] max-w-[calc(100vw-24px)]">
          {isMissionCollapsed ? (
            <button
              type="button"
              onClick={() => setIsMissionCollapsed(false)}
              className="pointer-events-auto self-start px-3 py-1.5 rounded-xl alara-glass hover:border-slate-400/30 flex items-center gap-2 text-[11px] font-mono alara-tabular text-[#F1F5F9] cursor-pointer whitespace-nowrap transition"
              title="Развернуть карточку миссии"
            >
              <span className="text-[#0EA5E9] font-bold">
                Фаза {snapshot.stepNumber}/{snapshot.totalSteps}
              </span>
              <span className="text-[#64748B]">·</span>
              <span className="text-[#F59E0B]">
                Очаги {snapshot.firesExtinguished}/{snapshot.totalFires}
              </span>
              <span className="text-[#64748B]">·</span>
              <span className="text-[#10B981]">
                Эвак. {snapshot.rescuedCount}/{snapshot.totalNpcCount}
              </span>
              <span className="text-[#64748B]">·</span>
              <span className="text-[#94A3B8]">
                Угрозы {emergencyOps.completedOpsCount}/{emergencyOps.totalOpsCount}
              </span>
              <ChevronDown className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
            </button>
          ) : (
            <div className="pointer-events-auto px-3.5 py-2.5 rounded-xl alara-glass space-y-2">
              {/* Заголовок фазы + таймер + свернуть */}
              <div className="flex items-center justify-between gap-2 text-[11px] font-mono">
                <span className="text-[#0EA5E9] font-bold truncate">
                  Фаза {snapshot.stepNumber}/{snapshot.totalSteps} · {snapshot.stepTitleRu}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[#94A3B8] flex items-center gap-1 alara-tabular whitespace-nowrap">
                    <Timer className="w-3 h-3" />
                    {timeStr}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsMissionCollapsed(true)}
                    className="p-0.5 rounded-[8px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                    title="Свернуть карточку миссии"
                  >
                    <ChevronUp className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="text-xs text-[#F1F5F9] leading-snug">{snapshot.instructionRu}</div>

              {/* Единая строка ключевых метрик */}
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-1.5 border-t border-slate-400/15 text-[11px] font-mono alara-tabular text-[#94A3B8]">
                <span className="text-[#F59E0B] whitespace-nowrap">
                  Очаги {snapshot.firesExtinguished}/{snapshot.totalFires}
                </span>
                <span className="text-[#64748B]">·</span>
                <span className="text-[#10B981] whitespace-nowrap">
                  Эвак. {snapshot.rescuedCount}/{snapshot.totalNpcCount}
                </span>
                <span className="text-[#64748B]">·</span>
                {vehicle.isHoseAttached ? (
                  <span className="text-[#0EA5E9] whitespace-nowrap">
                    ГМ-70 {vehicle.hoseLengthM.toFixed(0)} м
                  </span>
                ) : (
                  <span
                    className={`whitespace-nowrap ${
                      snapshot.extinguisherStatus === 'EMPTY'
                        ? 'text-[#EF4444] font-bold'
                        : snapshot.extinguisherStatus === 'ARMED'
                        ? 'text-[#14B8A6]'
                        : 'text-[#F59E0B]'
                    }`}
                  >
                    ОУ-5:{' '}
                    {snapshot.extinguisherStatus === 'ON_POST'
                      ? 'на посту'
                      : snapshot.extinguisherStatus === 'HELD_LOCKED'
                      ? `${snapshot.extinguisherChargePct}% [чека]`
                      : snapshot.extinguisherStatus === 'EMPTY'
                      ? 'пуст'
                      : `${snapshot.extinguisherChargePct}%`}
                  </span>
                )}
                {smokePct > 5 && (
                  <>
                    <span className="text-[#64748B]">·</span>
                    <span className={smokePct >= 45 ? 'text-[#F59E0B]' : 'text-[#94A3B8]'}>
                      Дым {smokePct}%
                    </span>
                  </>
                )}
              </div>

              {/* Лаконичная строка аварийных операций МЧС */}
              <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-400/15 text-[10px] font-mono alara-tabular">
                <span className={emergencyOps.radReconDone ? 'text-[#10B981]' : 'text-[#94A3B8]'}>
                  ДП-5В: {emergencyOps.radReconDone ? 'Готово' : `${Math.round(emergencyOps.radReconProgress01 * 100)}%`}
                </span>
                <span className={emergencyOps.loopIsolated ? 'text-[#10B981]' : 'text-[#F59E0B]'}>
                  Контур: {emergencyOps.loopIsolated ? 'Перекрыт' : 'Открыт'}
                </span>
                <span className={emergencyOps.casualtyStabilized ? 'text-[#10B981]' : 'text-[#EF4444]'}>
                  Медпомощь: {emergencyOps.casualtyStabilized ? 'Оказана' : 'Ожидает'}
                </span>
              </div>

              {/* Сворачиваемое сервисное меню (Фокус [K], Узлы, .GLB) */}
              <div className="pt-1.5 border-t border-slate-400/15 flex items-center justify-between gap-2 text-[10px] font-mono">
                <button
                  type="button"
                  onClick={() => setIsServiceToolsOpen(v => !v)}
                  className="flex items-center gap-1 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer whitespace-nowrap"
                >
                  {isServiceToolsOpen ? (
                    <ChevronDown className="w-3 h-3" />
                  ) : (
                    <ChevronRight className="w-3 h-3" />
                  )}
                  <span>Сервис и .glb</span>
                </button>

                {isServiceToolsOpen && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={onFocusModel}
                      className="px-2 py-0.5 rounded-[8px] alara-surface hover:bg-slate-800/80 text-[#10B981] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      title="Центрировать камеру на Box3 модели [K]"
                    >
                      <Crosshair className="w-3 h-3" />
                      <span>Фокус [K]</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsInspectorOpen(v => !v)}
                      className={`px-2 py-0.5 rounded-[8px] border flex items-center gap-1 cursor-pointer whitespace-nowrap ${
                        isInspectorOpen
                          ? 'bg-[#0EA5E9]/20 border-[#0EA5E9]/50 text-[#0EA5E9]'
                          : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8]'
                      }`}
                      title="Диагностика узлов /assembly.glb"
                    >
                      <Bug className="w-3 h-3" />
                      <span>Узлы</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="px-2 py-0.5 rounded-[8px] alara-surface hover:bg-slate-800/80 text-[#0EA5E9] flex items-center gap-1 cursor-pointer whitespace-nowrap"
                      title="Загрузить локальный .glb-файл"
                    >
                      <Upload className="w-3 h-3" />
                      <span>.GLB</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Инспектор графа .glb (открывается только вручную через Сервис -> Узлы) */}
          {!isMissionCollapsed && isServiceToolsOpen && isInspectorOpen && snapshot.inspectionReport && (
            <div className="pointer-events-auto p-3 rounded-xl alara-glass-elevated text-[11px] font-mono text-[#F1F5F9] space-y-1.5 max-h-56 overflow-y-auto">
              <div className="flex items-center justify-between text-[#0EA5E9] font-bold">
                <span>Инспектор АЭС ({snapshot.inspectionReport.sourceKind})</span>
                <span className="alara-tabular">{snapshot.inspectionReport.boundingBoxSize.join('×')} м</span>
              </div>
              <div className="text-[#94A3B8] alara-tabular">
                Узлов: {snapshot.inspectionReport.totalNodes} · Мешей:{' '}
                {snapshot.inspectionReport.totalMeshes} · Оборудование:{' '}
                <span className="text-[#10B981]">{snapshot.installedEquipmentCount}</span>
              </div>
              {snapshot.inspectionReport.buildingVolumes.length > 0 && (
                <div className="pt-1 border-t border-slate-400/15 text-[10px] text-[#94A3B8] space-y-0.5 alara-tabular">
                  {snapshot.inspectionReport.buildingVolumes.map((b, idx) => (
                    <div key={idx} className="truncate">
                      • {b.name}: {b.size.join('×')} м · пол Y={b.interiorFloorY} м
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {snapshot.warningBannerRu && (
            <div className="px-3 py-2 rounded-xl alara-glass border-[#EF4444]/60 text-xs text-rose-100 font-medium flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-[#EF4444] shrink-0" />
              <span>{snapshot.warningBannerRu}</span>
            </div>
          )}
        </div>
      )}

      {/* НИЖНИЙ ЛЕВЫЙ УГОЛ: Сворачиваемый чип / панель техники МЧС Узбекистана (АЦ-40) */}
      {isHudVisible && !snapshot.isLoadingGlb && !snapshot.loadErrorRu && !snapshot.debrief && (
        <div className="fixed bottom-16 left-3 z-30 pointer-events-none w-[320px] max-w-[calc(100vw-24px)]">
          {isVehicleCollapsed ? (
            <div className="pointer-events-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl alara-glass text-[11px] font-mono alara-tabular text-[#F1F5F9]">
              <button
                type="button"
                onClick={() => setIsVehicleCollapsed(false)}
                className="flex items-center gap-1.5 hover:text-white cursor-pointer whitespace-nowrap"
                title="Развернуть управление машиной АЦ-40 и рукавом"
              >
                <Truck className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
                <span className="font-semibold">АЦ-40</span>
                <span className="text-[#64748B]">·</span>
                <span className={vehicle.isSeated ? 'text-[#10B981]' : 'text-[#94A3B8]'}>
                  {vehicle.isSeated
                    ? `${vehicle.speedKmh} км/ч`
                    : vehicle.autopilotTargetName
                    ? `→ ${vehicle.autopilotTargetName}`
                    : vehicle.isHoseAttached
                    ? `Рукав ${vehicle.hoseLengthM.toFixed(0)}/${vehicle.maxHoseLengthM}м`
                    : 'На посту'}
                </span>
                <ChevronUp className="w-3.5 h-3.5 text-[#94A3B8] shrink-0" />
              </button>

              {(vehicle.isSeated || vehicle.nearDoor) && (
                <button
                  type="button"
                  onClick={onBoardOrExitVehicle}
                  className={`ml-1 px-2 py-0.5 rounded-[8px] text-[10px] font-semibold border cursor-pointer whitespace-nowrap ${
                    vehicle.isSeated
                      ? 'bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border-[#EF4444]/50 text-rose-200'
                      : 'bg-[#10B981] hover:bg-emerald-400 border-emerald-400 text-[#0B1117]'
                  }`}
                >
                  {vehicle.isSeated ? 'Выйти [Enter]' : 'Сесть [Enter]'}
                </button>
              )}
            </div>
          ) : (
            <div className="pointer-events-auto px-3.5 py-2.5 rounded-xl alara-glass space-y-2 text-[11px] font-mono">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[#F1F5F9] font-semibold truncate">
                  <Truck className="w-3.5 h-3.5 text-[#EF4444] shrink-0" />
                  <span className="truncate">АЦ-40 МЧС</span>
                  <span className="text-[#64748B]">·</span>
                  <span className={`alara-tabular ${vehicle.isSeated ? 'text-[#10B981]' : 'text-[#94A3B8]'}`}>
                    {vehicle.isSeated ? `${vehicle.speedKmh} км/ч` : vehicle.nearDoor ? 'У двери' : 'На посту'}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {onToggleBeacons && (
                    <button
                      type="button"
                      onClick={onToggleBeacons}
                      className={`px-2 py-0.5 rounded-[8px] border text-[10px] font-semibold cursor-pointer whitespace-nowrap ${
                        vehicle.beaconsOn
                          ? 'bg-[#0EA5E9]/20 hover:bg-[#0EA5E9]/30 border-[#0EA5E9]/60 text-sky-200'
                          : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8]'
                      }`}
                      title="Переключить проблесковые маяки СГУ АЦ-40 [L]"
                    >
                      Маяки [L]: {vehicle.beaconsOn ? 'ВКЛ' : 'ВЫКЛ'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onBoardOrExitVehicle}
                    className={`px-2 py-0.5 rounded-[8px] border text-[10px] font-semibold cursor-pointer whitespace-nowrap ${
                      vehicle.isSeated
                        ? 'bg-[#EF4444]/20 hover:bg-[#EF4444]/30 border-[#EF4444]/50 text-rose-200'
                        : vehicle.nearDoor
                        ? 'bg-[#10B981] hover:bg-emerald-400 border-emerald-400 text-[#0B1117]'
                        : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8]'
                    }`}
                  >
                    {vehicle.isSeated ? 'Выйти [Enter]' : 'В кабину [Enter]'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsVehicleCollapsed(true)}
                    className="p-0.5 rounded-[8px] alara-surface hover:bg-slate-800/80 text-[#94A3B8] hover:text-[#F1F5F9] cursor-pointer"
                    title="Свернуть панель техники"
                  >
                    <ChevronDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Автопилот между корпусами */}
              {vehicle.targets.length > 0 && (
                <div className="space-y-1 pt-1.5 border-t border-slate-400/15">
                  <div className="flex items-center justify-between text-[10px] text-[#94A3B8]">
                    <span className="flex items-center gap-1">
                      <Navigation className="w-3 h-3 text-[#0EA5E9]" />
                      <span>
                        {vehicle.autopilotTargetName
                          ? `Маршрут → ${vehicle.autopilotTargetName}`
                          : 'Автопилот [B]:'}
                      </span>
                    </span>
                    {vehicle.autopilotTargetName && (
                      <button
                        type="button"
                        onClick={onCancelAutopilot}
                        className="text-[#EF4444] hover:text-rose-300 underline cursor-pointer"
                      >
                        Стоп
                      </button>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {vehicle.targets.slice(0, 6).map(t => {
                      const isActiveTarget = vehicle.autopilotTargetName === t.name;
                      return (
                        <button
                          key={t.index}
                          type="button"
                          onClick={() => onStartAutopilot(t.index)}
                          className={`px-2 py-0.5 rounded-[8px] border text-[10px] alara-tabular cursor-pointer whitespace-nowrap ${
                            isActiveTarget
                              ? 'bg-[#0EA5E9]/20 border-[#0EA5E9] text-[#0EA5E9] font-semibold'
                              : 'alara-surface hover:bg-slate-800/80 text-[#94A3B8]'
                          }`}
                        >
                          {t.name.replace(/^Корпус\s*/i, 'Корп. ')} · {t.distanceM}м
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Пожарный рукав */}
              <div className="space-y-1 pt-1.5 border-t border-slate-400/15">
                <div className="flex items-center justify-between text-[10px] alara-tabular">
                  <span
                    className={
                      vehicle.hoseOverstretched
                        ? 'text-[#F59E0B] font-semibold'
                        : vehicle.isHoseAttached
                        ? 'text-[#0EA5E9]'
                        : 'text-[#94A3B8]'
                    }
                  >
                    Рукав {vehicle.isHoseAttached ? 'подключён' : 'на катушке'}
                  </span>
                  <span className="text-[#F1F5F9]">
                    {vehicle.hoseLengthM.toFixed(1)} / {vehicle.maxHoseLengthM} м
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className={`h-full transition-all duration-150 ${
                      vehicle.hoseOverstretched
                        ? 'bg-[#F59E0B]'
                        : vehicle.isHoseAttached
                        ? 'bg-[#0EA5E9]'
                        : 'bg-[#64748B]'
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#0B1117]/85 backdrop-blur-sm p-4 pointer-events-auto">
          <div
            className={`max-w-2xl w-full rounded-xl alara-glass-elevated p-6 space-y-4 ${
              isFailed ? 'border-[#EF4444]/50' : 'border-[#10B981]/45'
            }`}
          >
            <div className="flex items-start justify-between gap-3 border-b border-slate-400/15 pb-3">
              <div>
                <div
                  className={`text-xs font-mono flex items-center gap-1.5 ${
                    isFailed ? 'text-[#EF4444]' : 'text-[#10B981]'
                  }`}
                >
                  {isFailed ? (
                    <XCircle className="w-4 h-4" />
                  ) : (
                    <CheckCircle2 className="w-4 h-4" />
                  )}
                  <span>
                    {isFailed
                      ? 'Операция МЧС Узбекистана прервана'
                      : 'Операция МЧС Узбекистана завершена'}
                  </span>
                </div>
                <h2 className="text-lg font-bold text-[#F1F5F9] mt-1">
                  Итоговый протокол разбора (Сценарий №4)
                </h2>
              </div>
              <div
                className={`px-3 py-1.5 rounded-[10px] border font-mono alara-tabular text-sm font-bold flex items-center gap-1.5 ${
                  isFailed
                    ? 'bg-[#EF4444]/15 border-[#EF4444]/40 text-[#EF4444]'
                    : 'bg-[#10B981]/15 border-[#10B981]/40 text-[#10B981]'
                }`}
              >
                <Award className="w-4 h-4" />
                <span>Класс {snapshot.debrief.grade}</span>
              </div>
            </div>

            <div
              className={`text-xs font-medium border rounded-[10px] px-3.5 py-2 ${
                isFailed
                  ? 'text-rose-200 bg-[#EF4444]/10 border-[#EF4444]/35'
                  : 'text-emerald-200 bg-[#10B981]/10 border-[#10B981]/30'
              }`}
            >
              {snapshot.debrief.gradeLabelRu}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs font-mono alara-tabular">
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">ВРЕМЯ ОПЕРАЦИИ</div>
                <div className="text-base font-bold text-[#F1F5F9] mt-0.5">{timeStr}</div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">СПАСЕНО ПЕРСОНАЛА</div>
                <div className="text-base font-bold text-[#10B981] mt-0.5">
                  {snapshot.debrief.rescuedCount} / {snapshot.debrief.totalNpcCount} чел.
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">ПОТУШЕНО ОЧАГОВ</div>
                <div className="text-base font-bold text-[#F59E0B] mt-0.5">
                  {snapshot.debrief.extinguishedFires} / {snapshot.debrief.totalFires}
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">ОУ-5 / СРЕДСТВА</div>
                <div className="text-base font-bold text-[#0EA5E9] mt-0.5">
                  {snapshot.debrief.remainingExtinguisherPct}% ({snapshot.debrief.cylindersUsed} балл.)
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">ДОЗА ALARA</div>
                <div className="text-base font-bold text-[#F59E0B] mt-0.5">
                  {(snapshot.debrief.cumulativeDoseMsv * 1000).toFixed(1)} мкЗв
                </div>
              </div>
              <div className="p-3 rounded-[10px] alara-surface">
                <div className="text-[10px] text-[#94A3B8]">ПИК ТЕПЛОВОЙ НАГР.</div>
                <div className="text-base font-bold text-[#EF4444] mt-0.5">
                  {snapshot.debrief.peakHeatLoadPct}%
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] font-mono">
              <div
                className={`px-2.5 py-1.5 rounded-[10px] border ${
                  snapshot.debrief.radReconDone
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]'
                    : 'alara-surface text-[#94A3B8]'
                }`}
              >
                Разведка ДП-5В: {snapshot.debrief.radReconDone ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-[10px] border ${
                  snapshot.debrief.loopIsolated
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]'
                    : 'alara-surface text-[#94A3B8]'
                }`}
              >
                Контур перекрыт: {snapshot.debrief.loopIsolated ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-[10px] border ${
                  snapshot.debrief.casualtyStabilized
                    ? 'bg-[#10B981]/10 border-[#10B981]/40 text-[#10B981]'
                    : 'alara-surface text-[#94A3B8]'
                }`}
              >
                Медпомощь: {snapshot.debrief.casualtyStabilized ? 'ДА' : 'НЕТ'}
              </div>
              <div
                className={`px-2.5 py-1.5 rounded-[10px] border ${
                  snapshot.debrief.usedHoseOrVehicle
                    ? 'bg-[#0EA5E9]/10 border-[#0EA5E9]/40 text-[#0EA5E9]'
                    : 'alara-surface text-[#94A3B8]'
                }`}
              >
                АЦ-40 / Рукав: {snapshot.debrief.usedHoseOrVehicle ? 'ДА' : 'НЕТ'}
              </div>
            </div>

            {snapshot.debrief.safetyErrors.length > 0 ? (
              <div className="p-3 rounded-[10px] bg-[#EF4444]/10 border border-[#EF4444]/35 text-xs space-y-1">
                <div className="font-bold text-[#EF4444]">
                  Замечания по безопасности ({snapshot.debrief.safetyErrors.length}):
                </div>
                <ul className="list-disc list-inside text-rose-200 space-y-0.5">
                  {snapshot.debrief.safetyErrors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="p-3 rounded-[10px] bg-[#10B981]/10 border border-[#10B981]/30 text-xs text-emerald-200">
                Нарушений правил пожарной и радиационной безопасности не зафиксировано.
              </div>
            )}

            <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-[10px] alara-surface hover:bg-slate-800/80 text-[#F1F5F9] text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
              >
                <Upload className="w-3.5 h-3.5" />
                <span>Загрузить .glb</span>
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="px-5 py-2 rounded-[10px] bg-[#10B981] hover:bg-emerald-400 text-[#0B1117] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
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
