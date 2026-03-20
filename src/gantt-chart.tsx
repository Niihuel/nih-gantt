import * as React from 'react';
import { addDays, format } from 'date-fns';

import type { GanttTask, ViewMode } from './gantt-types';
import {
  ROW_HEIGHT,
  BAR_HEIGHT,
  BAR_RADIUS,
  HEADER_HEIGHT,
  BAR_Y_OFFSET,
} from './gantt-types';
import {
  getTimeRange,
  getTotalWidth,
  getTodayX,
  dateToX,
  getPxPerDay,
  cascadeDependencies,
  getUpperHeaders,
  getLowerHeaders,
  isTodayCell,
  getGridLines,
  getWeekendRanges,
  getTaskPositions,
  getArrowPath,
  getTextColor,
  formatDateES,
  getExpectedProgress,
  type TaskPosition,
} from './gantt-utils';

export type { GanttTask, ViewMode };
export { VIEW_OPTIONS } from './gantt-types';
export { toGanttTask } from './gantt-utils';

// ── Theme ──────────────────────────────────────────────────────────────────────

export interface GanttTheme {
  card: string;
  border: string;
  foreground: string;
  background: string;
  mutedForeground: string;
  accent: string;
  primary: string;
  muted: string;
}

const defaultTheme: GanttTheme = {
  card: 'var(--color-card, #141414)',
  border: 'var(--color-border, rgba(255,255,255,0.06))',
  foreground: 'var(--color-foreground, #D0D0D0)',
  background: 'var(--color-background, #0A0A0A)',
  mutedForeground: 'var(--color-muted-foreground, #777)',
  accent: 'var(--color-accent, rgba(232,220,200,0.10))',
  primary: 'var(--color-primary, #E8DCC8)',
  muted: 'var(--color-muted, rgba(255,255,255,0.04))',
};

// ── Props ──────────────────────────────────────────────────────────────────────

export interface GanttChartProps {
  tasks: GanttTask[];
  viewMode?: ViewMode;
  onViewChange?: (mode: ViewMode) => void;
  onClick?: (task: GanttTask) => void;
  readonly?: boolean;
  showProgress?: boolean;
  showExpectedProgress?: boolean;
  dateRange?: { from: Date; to: Date };
  onDateRangeChange?: (range: { from: Date; to: Date }) => void;
  moveDependencies?: boolean;
  onDateChange?: (task: GanttTask, newStart: string, newEnd: string, mode: 'resize' | 'move') => void;
  className?: string;
  /** Render a custom toolbar above the chart. Receives scrollToToday callback. */
  renderToolbar?: (ctx: { scrollToToday: () => void }) => React.ReactNode;
  /** Override default CSS variable-based theme */
  theme?: Partial<GanttTheme>;
  /** Empty state text */
  emptyText?: string;
  /** Tooltip render override. Return null to hide. */
  renderTooltip?: (task: GanttTask) => React.ReactNode;
}

// ── Component ──────────────────────────────────────────────────────────────────

export function GanttChart({
  tasks,
  viewMode: viewModeProp = 'Week',
  onViewChange,
  onClick,
  readonly = true,
  showProgress = false,
  showExpectedProgress = false,
  dateRange: dateRangeProp,
  onDateRangeChange,
  moveDependencies = true,
  onDateChange,
  className,
  renderToolbar,
  theme: themeProp,
  emptyText = 'No timeline data',
  renderTooltip,
}: GanttChartProps) {
  const t = { ...defaultTheme, ...themeProp };

  const [viewMode, setViewMode] = React.useState<ViewMode>(viewModeProp);
  const [dateRange, setDateRange] = React.useState<{ from: Date; to: Date } | undefined>(dateRangeProp);
  const [hoveredRow, setHoveredRow] = React.useState<number | null>(null);
  const [hoveredTask, setHoveredTask] = React.useState<GanttTask | null>(null);

  // Tooltip
  const [popupTask, setPopupTask] = React.useState<GanttTask | null>(null);
  const [cursorClientX, setCursorClientX] = React.useState(0);
  const [barScreenY, setBarScreenY] = React.useState(0);
  const popupTimeout = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  // Drag state — ref to avoid re-renders during pointermove
  const dragRef = React.useRef<{
    taskId: string;
    mode: 'resize-left' | 'resize-right' | 'move';
    startClientX: number;
    originalStart: string;
    originalEnd: string;
    originalDurationDays: number;
    lastDayDelta: number;
  } | null>(null);
  const [dragPreview, setDragPreview] = React.useState<Map<string, { x: number; width: number }> | null>(null);
  const isDragging = !!dragPreview;
  // Prevent click from firing after a drag (click fires after pointerup)
  const justDragged = React.useRef(false);

  React.useEffect(() => { setViewMode(viewModeProp); }, [viewModeProp]);
  React.useEffect(() => { setDateRange(dateRangeProp); }, [dateRangeProp]);

  const headerScrollRef = React.useRef<HTMLDivElement>(null);
  const bodyScrollRef = React.useRef<HTMLDivElement>(null);

  // Scroll sync
  const syncScroll = React.useCallback(() => {
    const body = bodyScrollRef.current;
    const header = headerScrollRef.current;
    if (!body || !header) return;
    requestAnimationFrame(() => { header.scrollLeft = body.scrollLeft; });
  }, []);

  // Ctrl+Scroll zoom
  const zoomCooldown = React.useRef(false);
  const ZOOM_ORDER: ViewMode[] = ['Year', 'Month', 'Week', 'Day'];

  React.useEffect(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      if (zoomCooldown.current) return;
      zoomCooldown.current = true;
      setTimeout(() => { zoomCooldown.current = false; }, 200);
      setViewMode((prev) => {
        const idx = ZOOM_ORDER.indexOf(prev);
        const next = e.deltaY < 0
          ? ZOOM_ORDER[Math.min(idx + 1, ZOOM_ORDER.length - 1)]
          : ZOOM_ORDER[Math.max(idx - 1, 0)];
        if (next !== prev) onViewChange?.(next);
        return next;
      });
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [onViewChange]);

  // Derived values
  const validTasks = React.useMemo(() => tasks.filter((t) => (t.start && t.end) || t.isGroupHeader), [tasks]);
  const range = React.useMemo(() => getTimeRange(tasks, viewMode, dateRange), [tasks, viewMode, dateRange]);
  const totalWidth = React.useMemo(() => getTotalWidth(range, viewMode), [range, viewMode]);
  const todayX = React.useMemo(() => getTodayX(range, viewMode), [range, viewMode]);
  const upperHeaders = React.useMemo(() => getUpperHeaders(range, viewMode), [range, viewMode]);
  const lowerHeaders = React.useMemo(() => getLowerHeaders(range, viewMode), [range, viewMode]);
  const gridLines = React.useMemo(() => getGridLines(range, viewMode), [range, viewMode]);
  const weekendRanges = React.useMemo(() => getWeekendRanges(range, viewMode), [range, viewMode]);
  const taskPositions = React.useMemo(() => getTaskPositions(validTasks, range, viewMode), [validTasks, range, viewMode]);
  const positionByTaskId = React.useMemo(() => new Map(taskPositions.map((p) => [p.task.id, p])), [taskPositions]);

  // SVG fills container
  const [containerHeight, setContainerHeight] = React.useState(400);
  React.useEffect(() => {
    const el = bodyScrollRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setContainerHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const svgHeight = Math.max(validTasks.length * ROW_HEIGHT + 20, containerHeight);

  const scrollToToday = React.useCallback(() => {
    if (todayX !== null && bodyScrollRef.current) {
      const vw = bodyScrollRef.current.clientWidth;
      bodyScrollRef.current.scrollTo({ left: todayX - vw / 2, behavior: 'smooth' });
    }
  }, [todayX]);

  // ── Drag handlers ─────────────────────────────────────────────

  const handleDragStart = React.useCallback((
    e: React.PointerEvent,
    task: GanttTask,
    mode: 'resize-left' | 'resize-right' | 'move',
  ) => {
    if (readonly) return;
    (e.currentTarget as SVGElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      taskId: task.id,
      mode,
      startClientX: e.clientX,
      originalStart: task.start,
      originalEnd: task.end,
      originalDurationDays: task.durationDays,
      lastDayDelta: 0,
    };
    // Suppress tooltip
    if (popupTimeout.current) clearTimeout(popupTimeout.current);
    setPopupTask(null);
  }, [readonly]);

  const handleDragMove = React.useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    const deltaX = e.clientX - drag.startClientX;
    const dayDelta = Math.round(deltaX / getPxPerDay(viewMode));
    if (dayDelta === drag.lastDayDelta) return;
    drag.lastDayDelta = dayDelta;

    const origStart = new Date(drag.originalStart);
    const origEnd = new Date(drag.originalEnd);
    let newStart: Date;
    let newEnd: Date;

    switch (drag.mode) {
      case 'resize-left':
        newStart = addDays(origStart, dayDelta);
        newEnd = origEnd;
        if (newStart >= newEnd) newStart = addDays(newEnd, -1);
        break;
      case 'resize-right':
        newStart = origStart;
        newEnd = addDays(origEnd, dayDelta);
        if (newEnd <= newStart) newEnd = addDays(newStart, 1);
        break;
      case 'move':
        newStart = addDays(origStart, dayDelta);
        newEnd = addDays(origEnd, dayDelta);
        break;
    }

    const preview = new Map<string, { x: number; width: number }>();
    const sx = dateToX(newStart, range, viewMode);
    const ex = dateToX(newEnd, range, viewMode);
    preview.set(drag.taskId, { x: sx, width: Math.max(ex - sx, 8) });

    if (moveDependencies && drag.mode !== 'move') {
      const cascade = cascadeDependencies(validTasks, drag.taskId, format(newEnd, 'yyyy-MM-dd'));
      cascade.forEach((dates, id) => {
        const cx = dateToX(dates.newStart, range, viewMode);
        const cxEnd = dateToX(dates.newEnd, range, viewMode);
        preview.set(id, { x: cx, width: Math.max(cxEnd - cx, 8) });
      });
    }

    setDragPreview(preview);
  }, [viewMode, range, validTasks, moveDependencies]);

  const handleDragEnd = React.useCallback((e: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;

    (e.currentTarget as SVGElement)?.releasePointerCapture?.(e.pointerId);

    if (drag.lastDayDelta !== 0 && onDateChange) {
      const origStart = new Date(drag.originalStart);
      const origEnd = new Date(drag.originalEnd);
      let newStart: Date;
      let newEnd: Date;

      switch (drag.mode) {
        case 'resize-left':
          newStart = addDays(origStart, drag.lastDayDelta);
          newEnd = origEnd;
          if (newStart >= newEnd) newStart = addDays(newEnd, -1);
          break;
        case 'resize-right':
          newStart = origStart;
          newEnd = addDays(origEnd, drag.lastDayDelta);
          if (newEnd <= newStart) newEnd = addDays(newStart, 1);
          break;
        case 'move':
          newStart = addDays(origStart, drag.lastDayDelta);
          newEnd = addDays(origEnd, drag.lastDayDelta);
          break;
      }

      const task = validTasks.find((tk) => tk.id === drag.taskId);
      if (task) {
        onDateChange(task, format(newStart, 'yyyy-MM-dd'), format(newEnd, 'yyyy-MM-dd'), drag.mode === 'move' ? 'move' : 'resize');
      }
    }

    // Block the click event that fires right after pointerup
    justDragged.current = true;
    requestAnimationFrame(() => { justDragged.current = false; });

    dragRef.current = null;
    setDragPreview(null);
  }, [onDateChange, validTasks]);

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className={className} style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: '1 1 0', minHeight: 0, background: t.card, border: `1px solid ${t.border}`, borderRadius: 6, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Toolbar slot */}
        {renderToolbar && (
          <div style={{ borderBottom: `1px solid ${t.border}`, padding: '8px 12px', flexShrink: 0 }}>
            {renderToolbar({ scrollToToday })}
          </div>
        )}

        {/* Header */}
        <div ref={headerScrollRef} style={{ overflow: 'hidden', flexShrink: 0, borderBottom: `1px solid ${t.border}` }}>
          <svg width={totalWidth} height={HEADER_HEIGHT} style={{ display: 'block' }}>
            {upperHeaders.map((cell, i) => (
              <g key={`u-${cell.x}`}>
                <rect x={cell.x} y={0} width={cell.width} height={HEADER_HEIGHT / 2} fill={t.card} stroke={t.border} strokeWidth={0.5} />
                <text x={cell.x + cell.width / 2} y={HEADER_HEIGHT / 4 + 4} textAnchor="middle" fontSize={11} fontWeight="600" fill={t.mutedForeground} style={{ textTransform: 'capitalize' }}>{cell.label}</text>
              </g>
            ))}
            {lowerHeaders.map((cell, i) => {
              const isToday = isTodayCell(cell, viewMode);
              const isHovered = hoveredTask ? (() => { const s = dateToX(hoveredTask.start, range, viewMode); const e = dateToX(hoveredTask.end, range, viewMode); return cell.x + cell.width > s && cell.x < e; })() : false;
              const pillW = Math.min(cell.width - 4, Math.max(cell.label.length * 6 + 16, 40));
              const pillH = HEADER_HEIGHT / 2 - 6;
              const pillX = cell.x + (cell.width - pillW) / 2;
              const pillY = HEADER_HEIGHT / 2 + 3;
              return (
                <g key={`l-${cell.x}`}>
                  <rect x={cell.x} y={HEADER_HEIGHT / 2} width={cell.width} height={HEADER_HEIGHT / 2} fill={t.card} stroke={t.border} strokeWidth={0.5} />
                  {isToday && <rect x={pillX} y={pillY} width={pillW} height={pillH} rx={pillH / 2} fill={t.foreground} opacity={0.9} />}
                  {isHovered && !isToday && <rect x={pillX} y={pillY} width={pillW} height={pillH} rx={pillH / 2} fill={t.accent} opacity={0.8} />}
                  <text x={cell.x + cell.width / 2} y={HEADER_HEIGHT / 2 + HEADER_HEIGHT / 4 + 3} textAnchor="middle" fontSize={10} fontWeight={isToday || isHovered ? '600' : '400'} fill={isToday ? t.background : isHovered ? t.foreground : t.mutedForeground}>{cell.label}</text>
                </g>
              );
            })}
            {todayX !== null && <circle cx={todayX} cy={HEADER_HEIGHT - 2} r={3} fill={t.foreground} />}
          </svg>
        </div>

        {/* Body */}
        <div ref={bodyScrollRef} style={{ flex: '1 1 0', minHeight: 0, overflow: 'auto', position: 'relative' }} onScroll={syncScroll}>
          {validTasks.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: t.mutedForeground, fontSize: 14 }}>{emptyText}</div>
          ) : (
            <svg width={totalWidth} height={svgHeight} style={{ display: 'block' }}>
              <defs>
                <pattern id="gantt-stripe" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="2" height="6" fill="white" />
                </pattern>
                <pattern id="gantt-stripe-animated" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="4" height="12" fill="white" />
                  <animateTransform attributeName="patternTransform" type="translate" from="0 0" to="12 0" dur="1s" repeatCount="indefinite" additive="sum" />
                </pattern>
              </defs>
              {weekendRanges.map((wr, i) => <rect key={`we-${wr.x}`} x={wr.x} y={0} width={wr.width} height={svgHeight} fill={t.muted} opacity={0.4} />)}
              {gridLines.map((gl, i) => <line key={`gl-${gl.x}`} x1={gl.x} y1={0} x2={gl.x} y2={svgHeight} stroke={t.border} strokeWidth={0.5} opacity={0.5} />)}
              {todayX !== null && <line x1={todayX} y1={0} x2={todayX} y2={svgHeight} stroke={t.primary} strokeWidth={2} opacity={0.8} />}
              {hoveredRow !== null && <rect x={0} y={hoveredRow * ROW_HEIGHT} width={totalWidth} height={ROW_HEIGHT} fill={t.accent} opacity={0.3} pointerEvents="none" />}
              {taskPositions.flatMap((pos) => { if (pos.task.isGroupHeader) return []; return (pos.task.dependencies ?? []).map((depId) => { const from = positionByTaskId.get(depId); if (!from) return null; return <path key={`a-${depId}-${pos.task.id}`} d={getArrowPath(from, pos)} fill="none" stroke={t.mutedForeground} strokeWidth={1.5} opacity={0.5} />; }); })}
              {taskPositions.map((pos) => {
                if (pos.task.isGroupHeader) {
                  return (
                    <g key={pos.task.id}>
                      <rect x={0} y={pos.row * ROW_HEIGHT} width={totalWidth} height={ROW_HEIGHT} fill={t.muted} opacity={0.3} />
                      <text x={16} y={pos.row * ROW_HEIGHT + ROW_HEIGHT / 2 + 4} fontSize={11} fontWeight="600" fill={t.mutedForeground} style={{ pointerEvents: 'none', userSelect: 'none' }}>{pos.task.groupLabel || ''}</text>
                    </g>
                  );
                }
                const preview = dragPreview?.get(pos.task.id);
                const barX = preview?.x ?? pos.x;
                const barW = preview?.width ?? pos.width;
                const barColor = pos.task.color ?? '#6366f1';
                const textColor = getTextColor(barColor);
                const label = `${pos.task.name} (${pos.task.durationDays}d)`;
                const approxTextWidth = label.length * 6.5 + 16;
                const fitsInside = barW >= approxTextWidth;
                return (
                  <g
                    key={pos.task.id}
                    style={{ cursor: onClick ? 'pointer' : 'default' }}
                    onClick={() => { if (justDragged.current) return; onClick?.(pos.task); }}
                    onPointerMove={(e) => handleDragMove(e.nativeEvent)}
                    onPointerUp={(e) => handleDragEnd(e.nativeEvent)}
                    onMouseEnter={(e) => {
                      if (isDragging) return;
                      setHoveredRow(pos.row);
                      setHoveredTask(pos.task);
                      setCursorClientX(e.clientX);
                      const s = bodyScrollRef.current;
                      if (s) { setBarScreenY(s.getBoundingClientRect().top + pos.row * ROW_HEIGHT - s.scrollTop); }
                      if (popupTimeout.current) clearTimeout(popupTimeout.current);
                      popupTimeout.current = setTimeout(() => setPopupTask(pos.task), 200);
                    }}
                    onMouseMove={(e) => setCursorClientX(e.clientX)}
                    onMouseLeave={() => {
                      setHoveredRow(null);
                      setHoveredTask(null);
                      if (popupTimeout.current) clearTimeout(popupTimeout.current);
                      setPopupTask(null);
                    }}
                  >
                    {/* Hit area */}
                    <rect x={barX} y={pos.row * ROW_HEIGHT} width={Math.max(barW, 60)} height={ROW_HEIGHT} fill="transparent" pointerEvents="all" />
                    {/* Background */}
                    <rect
                      x={barX} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET}
                      width={barW} height={BAR_HEIGHT}
                      rx={BAR_RADIUS} ry={BAR_RADIUS}
                      fill={barColor} opacity={pos.task.completed ? 0.5 : 0.7}
                      style={{ cursor: !readonly ? (isDragging ? 'grabbing' : 'grab') : (onClick ? 'pointer' : 'default') }}
                      onPointerDown={(e) => {
                        if (readonly) return;
                        e.stopPropagation();
                        handleDragStart(e, pos.task, 'move');
                      }}
                    />
                    {/* Progress bar with stripe overlay */}
                    {(() => {
                      const expected = getExpectedProgress(pos.task);
                      const realProgress = pos.task.progress > 0 ? pos.task.progress : 0;
                      const visualProgress = showProgress && realProgress > 0
                        ? realProgress
                        : showExpectedProgress && expected > 0 && expected < 100
                          ? expected
                          : 0;
                      if (visualProgress <= 0) return null;
                      const isInProgress = expected > 0 && expected < 100 && !pos.task.completed;
                      const stripeId = isInProgress ? 'gantt-stripe-animated' : 'gantt-stripe';
                      return (
                        <>
                          <rect
                            x={barX} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET}
                            width={(barW * visualProgress) / 100}
                            height={BAR_HEIGHT}
                            rx={BAR_RADIUS} ry={BAR_RADIUS}
                            fill={barColor} opacity={0.9}
                          />
                          <rect
                            x={barX} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET}
                            width={(barW * visualProgress) / 100}
                            height={BAR_HEIGHT}
                            rx={BAR_RADIUS} ry={BAR_RADIUS}
                            fill={`url(#${stripeId})`} opacity={0.3}
                          />
                        </>
                      );
                    })()}
                    {/* Expected progress line (dashed vertical) */}
                    {showExpectedProgress && (() => {
                      const expected = getExpectedProgress(pos.task);
                      if (expected <= 0 || expected >= 100) return null;
                      const lineX = barX + (barW * expected) / 100;
                      const clampedX = Math.max(barX + BAR_RADIUS, Math.min(lineX, barX + barW - BAR_RADIUS));
                      return (
                        <line
                          x1={clampedX} y1={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + 2}
                          x2={clampedX} y2={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + BAR_HEIGHT - 2}
                          stroke="rgba(255,255,255,0.4)"
                          strokeWidth={1.5}
                          strokeDasharray="3 2"
                          pointerEvents="none"
                        />
                      );
                    })()}
                    {/* Label — inside bar if fits, outside (right) if not */}
                    {fitsInside
                      ? <text x={barX + barW / 2} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + BAR_HEIGHT / 2 + 4} textAnchor="middle" fontSize={11} fontWeight="500" fill={textColor} style={{ pointerEvents: 'none', userSelect: 'none' }}>{label}</text>
                      : <text x={barX + barW + 8} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + BAR_HEIGHT / 2 + 4} textAnchor="start" fontSize={11} fontWeight="500" fill={t.mutedForeground} style={{ pointerEvents: 'none', userSelect: 'none' }}>{label}</text>
                    }
                    {/* Drag handles — only when editable and bar is wide enough */}
                    {!readonly && barW >= 24 && (
                      <>
                        {/* Left handle */}
                        <rect
                          x={barX} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + 4}
                          width={8} height={BAR_HEIGHT - 8}
                          rx={3} fill="rgba(255,255,255,0.001)"
                          style={{ cursor: 'ew-resize' }}
                          onPointerDown={(e) => { e.stopPropagation(); handleDragStart(e, pos.task, 'resize-left'); }}
                        />
                        {/* Right handle */}
                        <rect
                          x={barX + barW - 8} y={pos.row * ROW_HEIGHT + BAR_Y_OFFSET + 4}
                          width={8} height={BAR_HEIGHT - 8}
                          rx={3} fill="rgba(255,255,255,0.001)"
                          style={{ cursor: 'ew-resize' }}
                          onPointerDown={(e) => { e.stopPropagation(); handleDragStart(e, pos.task, 'resize-right'); }}
                        />
                      </>
                    )}
                  </g>
                );
              })}
            </svg>
          )}
        </div>
      </div>

      {/* Tooltip — position:fixed on screen, immune to scroll */}
      {popupTask && !isDragging && (() => {
        const tooltipW = 220; const tooltipH = 70; const gap = 8;
        const winW = typeof window !== 'undefined' ? window.innerWidth : 1200;
        const showBelow = barScreenY < tooltipH + gap + 20;
        const tipY = showBelow ? barScreenY + ROW_HEIGHT + gap : barScreenY - gap;
        let tipX = cursorClientX;
        if (tipX - tooltipW / 2 < 8) tipX = tooltipW / 2 + 8;
        if (tipX + tooltipW / 2 > winW - 8) tipX = winW - tooltipW / 2 - 8;

        const defaultTooltipContent = (
          <div style={{ background: t.foreground, color: t.background, borderRadius: 6, padding: '6px 12px', fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
            <div style={{ fontWeight: 600 }}>{popupTask.name}</div>
            <div style={{ opacity: 0.8, marginTop: 2 }}>{formatDateES(popupTask.start)} - {formatDateES(popupTask.end)}</div>
            <div style={{ opacity: 0.8 }}>
              {popupTask.durationDays} {popupTask.durationDays === 1 ? 'dia' : 'dias'}
              {popupTask.progress > 0 ? ` · ${popupTask.progress}%` : ''}
            </div>
            {showExpectedProgress && (() => {
              const expected = getExpectedProgress(popupTask);
              if (showProgress && popupTask.progress > 0) {
                const delta = popupTask.progress - expected;
                return (
                  <>
                    <div style={{ opacity: 0.8 }}>Progreso: {popupTask.progress}% · Esperado: {expected}%</div>
                    {delta !== 0 && (
                      <div style={{ color: delta > 0 ? '#10b981' : '#ef4444', fontWeight: 600 }}>
                        {delta > 0 ? '+' : ''}{delta}% {delta > 0 ? 'adelantado' : 'atrasado'}
                      </div>
                    )}
                  </>
                );
              }
              return <div style={{ opacity: 0.8 }}>Plazo transcurrido: {expected}%</div>;
            })()}
          </div>
        );

        const content = renderTooltip ? renderTooltip(popupTask) : defaultTooltipContent;
        if (content === null) return null;
        return (
          <div style={{ position: 'fixed', zIndex: 9999, left: tipX, top: tipY, transform: showBelow ? 'translateX(-50%)' : 'translate(-50%, -100%)', transition: 'left 50ms ease-out', pointerEvents: 'none' }}>
            {content}
            <div style={{ position: 'absolute', left: '50%', transform: 'translateX(-50%) rotate(45deg)', width: 10, height: 10, borderRadius: 2, background: t.foreground, ...(showBelow ? { top: -3 } : { bottom: -3 }) }} />
          </div>
        );
      })()}
    </div>
  );
}
