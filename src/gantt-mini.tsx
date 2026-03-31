import * as React from 'react';
import type { GanttTask } from './gantt-types';
import { MINI_ROW_HEIGHT, MINI_BAR_HEIGHT, MINI_BAR_Y_OFFSET, BAR_RADIUS } from './gantt-types';
import { toTimestamp } from './gantt-utils';

export type { GanttTask };

export interface GanttMiniProps {
  tasks: GanttTask[];
  height?: number;
  showTooltip?: boolean;
  showProgress?: boolean;
  className?: string;
  style?: React.CSSProperties;
  /** Label text. Default: "Preview" */
  label?: string;
  /** Completed label. Default: "completed" */
  completedLabel?: string;
}

export function GanttMini({
  tasks,
  height,
  showTooltip = true,
  showProgress = false,
  className,
  style,
  label = 'Preview',
  completedLabel = 'completed',
}: GanttMiniProps) {
  const [hoveredIndex, setHoveredIndex] = React.useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = React.useState<{ x: number; y: number }>({ x: 0, y: 0 });

  const validTasks = React.useMemo(() => tasks.filter((t) => t.start && t.end), [tasks]);

  if (validTasks.length === 0) return null;

  const minTime = Math.min(...validTasks.map((t) => toTimestamp(t.start)));
  const maxTime = Math.max(...validTasks.map((t) => toTimestamp(t.end)));
  const totalRange = maxTime - minTime;

  const computedHeight = height ?? validTasks.length * MINI_ROW_HEIGHT;
  const completedCount = validTasks.filter((t) => t.completed).length;

  return (
    <div className={className} style={{ borderRadius: 8, padding: 16, ...style }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', opacity: 0.5 }}>{label}</span>
        {completedCount > 0 && (
          <span style={{ fontSize: 11, fontWeight: 500, color: '#10b981' }}>
            {completedCount}/{validTasks.length} {completedLabel}
          </span>
        )}
      </div>

      <div style={{ position: 'relative' }}>
        <svg width="100%" height={computedHeight} style={{ display: 'block' }}>
          <defs>
            <pattern id="gantt-mini-stripe" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
              <rect width="2" height="6" fill="white" />
            </pattern>
          </defs>
          {validTasks.map((task, index) => {
            const taskStart = toTimestamp(task.start);
            const taskEnd = toTimestamp(task.end);
            const leftPct = totalRange > 0 ? ((taskStart - minTime) / totalRange) * 100 : 0;
            const widthPct = totalRange > 0 ? Math.max(((taskEnd - taskStart) / totalRange) * 100, 1) : 1;
            const y = index * MINI_ROW_HEIGHT + MINI_BAR_Y_OFFSET;
            const barColor = task.color ?? '#6366f1';

            return (
              <g
                key={task.id}
                onMouseEnter={(e) => { if (showTooltip) { setHoveredIndex(index); setTooltipPos({ x: e.clientX, y: e.clientY }); } }}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* Background bar */}
                <rect x={`${leftPct}%`} y={y} width={`${widthPct}%`} height={MINI_BAR_HEIGHT} rx={BAR_RADIUS} fill={barColor} opacity={task.completed ? 0.5 : 0.7} />
                {/* Progress fill with stripe */}
                {showProgress && task.progress > 0 && (
                  <>
                    <rect
                      x={`${leftPct}%`}
                      y={y}
                      width={`${Math.max(widthPct * task.progress / 100, 0.5)}%`}
                      height={MINI_BAR_HEIGHT}
                      rx={BAR_RADIUS}
                      ry={BAR_RADIUS}
                      fill={barColor}
                      opacity={0.9}
                    />
                    <rect
                      x={`${leftPct}%`}
                      y={y}
                      width={`${Math.max(widthPct * task.progress / 100, 0.5)}%`}
                      height={MINI_BAR_HEIGHT}
                      rx={BAR_RADIUS}
                      ry={BAR_RADIUS}
                      fill="url(#gantt-mini-stripe)"
                      opacity={0.3}
                    />
                  </>
                )}
                {/* Stripe overlay if completed */}
                {task.completed && <rect x={`${leftPct}%`} y={y} width={`${widthPct}%`} height={MINI_BAR_HEIGHT} rx={BAR_RADIUS} fill="url(#gantt-mini-stripe)" opacity={0.25} />}
              </g>
            );
          })}
        </svg>
      </div>

      {/* Simple tooltip */}
      {hoveredIndex !== null && showTooltip && (() => {
        const task = validTasks[hoveredIndex];
        return (
          <div style={{ position: 'fixed', zIndex: 9999, left: tooltipPos.x, top: tooltipPos.y - 8, transform: 'translate(-50%, -100%)', pointerEvents: 'none' }}>
            <div style={{ background: '#1a1a1a', color: '#fff', borderRadius: 6, padding: '4px 10px', fontSize: 11, boxShadow: '0 4px 12px rgba(0,0,0,0.3)', whiteSpace: 'nowrap' }}>
              <div style={{ fontWeight: 600 }}>{task.name}</div>
              <div style={{ opacity: 0.7 }}>{task.durationDays} {task.durationDays === 1 ? 'dia' : 'dias'}</div>
              {task.completed && <div style={{ color: '#10b981' }}>Completada</div>}
            </div>
          </div>
        );
      })()}
    </div>
  );
}
