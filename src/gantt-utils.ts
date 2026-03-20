import {
  addDays,
  addWeeks,
  addMonths,
  startOfDay,
  startOfWeek,
  startOfMonth,
  startOfYear,
  differenceInCalendarDays,
  differenceInCalendarMonths,
  getISOWeek,
  format,
  isWeekend,
  eachDayOfInterval,
  eachWeekOfInterval,
  eachMonthOfInterval,
} from 'date-fns';
import { es } from 'date-fns/locale';
import type { GanttTask, ViewMode } from './gantt-types';
import {
  COLUMN_WIDTHS,
  ROW_HEIGHT,
  BAR_HEIGHT,
  BAR_Y_OFFSET,
  HEADER_HEIGHT,
} from './gantt-types';

// ── Time range ────────────────────────────────────────────────────────────────

export interface TimeRange {
  start: Date;
  end: Date;
}

/** Pixels per day for the given view mode. */
function pxPerDay(viewMode: ViewMode): number {
  const colWidth = COLUMN_WIDTHS[viewMode];
  // Day → 1 day/col, Week → 7 days/col, Month → 30 days/col, Year → 30 days/col (quarters of ~91)
  switch (viewMode) {
    case 'Day':
      return colWidth / 1;
    case 'Week':
      return colWidth / 7;
    case 'Month':
      return colWidth / 30;
    case 'Year':
      return colWidth / 30;
  }
}

/**
 * Compute the visible time range for the chart.
 * When dateRange is provided, use it directly.
 * Otherwise derive from task dates with per-view-mode padding.
 * Falls back to today ±7/30 days when no valid tasks exist.
 */
export function getTimeRange(
  tasks: GanttTask[],
  viewMode: ViewMode,
  dateRange?: { from: Date; to: Date },
): TimeRange {
  if (dateRange) {
    return { start: startOfDay(dateRange.from), end: startOfDay(dateRange.to) };
  }

  const validTasks = tasks.filter((t) => t.start && t.end);
  if (validTasks.length === 0) {
    const today = startOfDay(new Date());
    return { start: addDays(today, -7), end: addDays(today, 30) };
  }

  const starts = validTasks.map((t) => startOfDay(new Date(t.start))).sort((a, b) => a.getTime() - b.getTime());
  const ends = validTasks.map((t) => startOfDay(new Date(t.end))).sort((a, b) => b.getTime() - a.getTime());
  const minDate = starts[0];
  const maxDate = ends[0];

  // Add padding depending on view mode
  let paddedStart: Date;
  let paddedEnd: Date;

  switch (viewMode) {
    case 'Day':
      paddedStart = addDays(minDate, -2);
      paddedEnd = addDays(maxDate, 2);
      break;
    case 'Week':
      paddedStart = addWeeks(startOfWeek(minDate, { locale: es }), -1);
      paddedEnd = addWeeks(minDate, 1);
      // use maxDate for end
      paddedEnd = addWeeks(startOfWeek(maxDate, { locale: es }), 2);
      break;
    case 'Month':
      paddedStart = startOfMonth(addMonths(minDate, -1));
      paddedEnd = startOfMonth(addMonths(maxDate, 2));
      break;
    case 'Year':
      paddedStart = startOfYear(minDate);
      paddedEnd = addMonths(startOfYear(maxDate), 15);
      break;
  }

  return { start: paddedStart, end: paddedEnd };
}

// ── Date ↔ X position ─────────────────────────────────────────────────────────

/**
 * Convert a date to an X pixel position relative to range.start.
 */
export function dateToX(date: Date | string, range: TimeRange, viewMode: ViewMode): number {
  const d = typeof date === 'string' ? startOfDay(new Date(date)) : startOfDay(date);
  const dayOffset = differenceInCalendarDays(d, range.start);
  return dayOffset * pxPerDay(viewMode);
}

/**
 * Total pixel width of the chart for the given range.
 * Minimum 600px.
 */
export function getTotalWidth(range: TimeRange, viewMode: ViewMode): number {
  const totalDays = differenceInCalendarDays(range.end, range.start);
  const width = totalDays * pxPerDay(viewMode);
  return Math.max(width, 600);
}

// ── Column headers (two levels) ───────────────────────────────────────────────

export interface HeaderCell {
  label: string;
  x: number;
  width: number;
  date?: Date; // the date this cell represents (for today highlight)
}

/**
 * Upper header row:
 * - Day/Week view → month labels
 * - Month/Year view → year labels
 */
export function getUpperHeaders(range: TimeRange, viewMode: ViewMode): HeaderCell[] {
  const ppd = pxPerDay(viewMode);
  const cells: HeaderCell[] = [];

  if (viewMode === 'Day' || viewMode === 'Week') {
    // Group by month
    const months = eachMonthOfInterval({ start: range.start, end: range.end });
    for (const monthStart of months) {
      // Clamp month start to range
      const cellStart = monthStart < range.start ? range.start : monthStart;
      const nextMonth = addMonths(monthStart, 1);
      const cellEnd = nextMonth > range.end ? range.end : nextMonth;
      const x = differenceInCalendarDays(cellStart, range.start) * ppd;
      const width = differenceInCalendarDays(cellEnd, cellStart) * ppd;
      if (width <= 0) continue;
      cells.push({
        label: format(monthStart, 'MMMM yyyy', { locale: es }),
        x,
        width,
      });
    }
  } else {
    // Group by year
    let cursor = startOfYear(range.start);
    while (cursor <= range.end) {
      const nextYear = addMonths(cursor, 12);
      const cellStart = cursor < range.start ? range.start : cursor;
      const cellEnd = nextYear > range.end ? range.end : nextYear;
      const x = differenceInCalendarDays(cellStart, range.start) * ppd;
      const width = differenceInCalendarDays(cellEnd, cellStart) * ppd;
      if (width > 0) {
        cells.push({
          label: format(cursor, 'yyyy'),
          x,
          width,
        });
      }
      cursor = nextYear;
    }
  }

  return cells;
}

/**
 * Lower header row (frappe-gantt style):
 * - Day view → day numbers (1, 2, 3…)
 * - Week view → date range "09 Mar - 15" or "30 - 05 Abr" (frappe-gantt formatWeek)
 * - Month view → abbreviated month name (es)
 * - Year view → "TN" quarters (T1, T2, T3, T4)
 */
export function getLowerHeaders(range: TimeRange, viewMode: ViewMode): HeaderCell[] {
  const ppd = pxPerDay(viewMode);
  const cells: HeaderCell[] = [];

  switch (viewMode) {
    case 'Day': {
      const days = eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) });
      for (const day of days) {
        const x = differenceInCalendarDays(day, range.start) * ppd;
        cells.push({ label: format(day, 'd'), x, width: ppd, date: day });
      }
      break;
    }
    case 'Week': {
      // Frappe-gantt style: "09 Mar - 15" or "30 - 05 Abr"
      const weeks = eachWeekOfInterval(
        { start: range.start, end: range.end },
        { locale: es },
      );
      let lastWeekStart: Date | null = null;
      for (const weekStart of weeks) {
        const cellStart = weekStart < range.start ? range.start : weekStart;
        const weekEnd = addWeeks(weekStart, 1);
        const cellEnd = weekEnd > range.end ? range.end : weekEnd;
        const x = differenceInCalendarDays(cellStart, range.start) * ppd;
        const width = differenceInCalendarDays(cellEnd, cellStart) * ppd;
        if (width <= 0) continue;

        // Format like frappe-gantt: "D MMM - D" or "D - D MMM" when month changes
        const endOfWeek = addDays(weekStart, 6);
        const monthChanged = endOfWeek.getMonth() !== weekStart.getMonth();
        const showStartMonth = !lastWeekStart || weekStart.getMonth() !== lastWeekStart.getMonth();

        const startFmt = showStartMonth
          ? format(weekStart, 'd MMM', { locale: es })
          : format(weekStart, 'd');
        const endFmt = monthChanged
          ? format(endOfWeek, 'd MMM', { locale: es })
          : format(endOfWeek, 'd');

        cells.push({ label: `${startFmt} - ${endFmt}`, x, width, date: weekStart });
        lastWeekStart = weekStart;
      }
      break;
    }
    case 'Month': {
      const months = eachMonthOfInterval({ start: range.start, end: range.end });
      for (const monthStart of months) {
        const cellStart = monthStart < range.start ? range.start : monthStart;
        const nextMonth = addMonths(monthStart, 1);
        const cellEnd = nextMonth > range.end ? range.end : nextMonth;
        const x = differenceInCalendarDays(cellStart, range.start) * ppd;
        const width = differenceInCalendarDays(cellEnd, cellStart) * ppd;
        if (width <= 0) continue;
        cells.push({
          label: format(monthStart, 'MMMM', { locale: es }),
          x,
          width,
          date: monthStart,
        });
      }
      break;
    }
    case 'Year': {
      let cursor = startOfYear(range.start);
      while (cursor <= range.end) {
        for (let q = 0; q < 4; q++) {
          const qStart = addMonths(cursor, q * 3);
          const qEnd = addMonths(qStart, 3);
          if (qStart > range.end) break;
          const cellStart = qStart < range.start ? range.start : qStart;
          const cellEnd = qEnd > range.end ? range.end : qEnd;
          const x = differenceInCalendarDays(cellStart, range.start) * ppd;
          const width = differenceInCalendarDays(cellEnd, cellStart) * ppd;
          if (width <= 0) continue;
          cells.push({ label: `T${q + 1}`, x, width, date: qStart });
        }
        cursor = addMonths(cursor, 12);
      }
      break;
    }
  }

  return cells;
}

/** Check if a header cell contains today's date */
export function isTodayCell(cell: HeaderCell, viewMode: ViewMode): boolean {
  if (!cell.date) return false;
  const today = startOfDay(new Date());
  const d = cell.date;
  switch (viewMode) {
    case 'Day': return d.getTime() === today.getTime();
    case 'Week': return today >= d && today < addWeeks(d, 1);
    case 'Month': return today.getMonth() === d.getMonth() && today.getFullYear() === d.getFullYear();
    case 'Year': return today >= d && today < addMonths(d, 3);
  }
}

// ── Grid lines ────────────────────────────────────────────────────────────────

export interface GridLine {
  x: number;
  isThick: boolean;
  isWeekend?: boolean;
}

/**
 * Vertical grid lines for the chart body.
 * - Day: one line per day; thick on Monday (start of week)
 * - Week: one line per week; thick on month boundaries
 * - Month: one line per month; thick on year boundaries
 * - Year: one line per quarter; thick on year boundaries
 */
export function getGridLines(range: TimeRange, viewMode: ViewMode): GridLine[] {
  const ppd = pxPerDay(viewMode);
  const lines: GridLine[] = [];

  switch (viewMode) {
    case 'Day': {
      const days = eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) });
      for (const day of days) {
        const x = differenceInCalendarDays(day, range.start) * ppd;
        const isMonday = day.getDay() === 1;
        lines.push({ x, isThick: isMonday, isWeekend: isWeekend(day) });
      }
      break;
    }
    case 'Week': {
      const weeks = eachWeekOfInterval(
        { start: range.start, end: range.end },
        { locale: es },
      );
      for (const weekStart of weeks) {
        if (weekStart < range.start) continue;
        const x = differenceInCalendarDays(weekStart, range.start) * ppd;
        const isMonthStart = weekStart.getDate() <= 7;
        lines.push({ x, isThick: isMonthStart });
      }
      break;
    }
    case 'Month': {
      const months = eachMonthOfInterval({ start: range.start, end: range.end });
      for (const monthStart of months) {
        if (monthStart < range.start) continue;
        const x = differenceInCalendarDays(monthStart, range.start) * ppd;
        const isYearStart = monthStart.getMonth() === 0;
        lines.push({ x, isThick: isYearStart });
      }
      break;
    }
    case 'Year': {
      // Lines at each quarter
      let cursor = startOfYear(range.start);
      while (cursor <= range.end) {
        for (let q = 0; q < 4; q++) {
          const qStart = addMonths(cursor, q * 3);
          if (qStart < range.start || qStart > range.end) continue;
          const x = differenceInCalendarDays(qStart, range.start) * ppd;
          const isYearStart = q === 0;
          lines.push({ x, isThick: isYearStart });
        }
        cursor = addMonths(cursor, 12);
      }
      break;
    }
  }

  return lines;
}

// ── Weekend ranges (Day view only) ────────────────────────────────────────────

export interface WeekendRange {
  x: number;
  width: number;
}

/**
 * Returns shaded regions for weekend days in Day view.
 * Returns empty array for other view modes.
 */
export function getWeekendRanges(range: TimeRange, viewMode: ViewMode): WeekendRange[] {
  if (viewMode !== 'Day') return [];

  const ppd = pxPerDay(viewMode);
  const ranges: WeekendRange[] = [];
  const days = eachDayOfInterval({ start: range.start, end: addDays(range.end, -1) });

  for (const day of days) {
    if (isWeekend(day)) {
      const x = differenceInCalendarDays(day, range.start) * ppd;
      ranges.push({ x, width: ppd });
    }
  }

  return ranges;
}

// ── Task layout ───────────────────────────────────────────────────────────────

export interface TaskPosition {
  task: GanttTask;
  row: number;
  x: number;
  width: number;
  y: number;
}

/**
 * Compute pixel positions for all tasks.
 * Each task occupies one row; order is preserved.
 * Minimum bar width is 8px.
 */
export function getTaskPositions(
  tasks: GanttTask[],
  range: TimeRange,
  viewMode: ViewMode,
): TaskPosition[] {
  return tasks.map((task, index) => {
    const x = dateToX(task.start, range, viewMode);
    const endX = dateToX(task.end, range, viewMode);
    const rawWidth = endX - x;
    const width = Math.max(rawWidth, 8);
    // y is relative to the body SVG (no HEADER_HEIGHT offset — header is a separate SVG)
    const y = index * ROW_HEIGHT + BAR_Y_OFFSET;
    return { task, row: index, x, width, y };
  });
}

// ── Dependency arrows ─────────────────────────────────────────────────────────

/**
 * Dependency arrow path — replicates frappe-gantt style.
 * Starts from bottom-center of 'from' bar, goes down, curves to the left edge of 'to' bar.
 * Includes arrowhead (m -5 -5 l 5 5 l -5 5) built into the path.
 */
export function getArrowPath(from: TaskPosition, to: TaskPosition): string {
  const padding = ROW_HEIGHT - BAR_HEIGHT; // gap between bars
  const curve = 6;

  // Start from center-bottom of source bar
  let startX = from.x + from.width / 2;
  const startY = from.y + BAR_HEIGHT;

  // End at left edge of target bar (with 13px gap for arrowhead)
  const endX = to.x - 13;
  const endY = to.y + BAR_HEIGHT / 2;

  const fromIsBelow = from.row > to.row;
  const clockwise = fromIsBelow ? 1 : 0;
  let curveY = fromIsBelow ? -curve : curve;

  // Adjust startX if to_bar is too close/behind from_bar
  const minStartX = from.x + padding;
  while (to.x < startX + padding && startX > minStartX) {
    startX -= 10;
  }
  startX -= 10;

  if (to.x <= from.x + padding) {
    // Complex path: go down, left, then to target
    let down1 = padding / 2 - curve;
    let localCurve = curve;
    if (down1 < 0) {
      down1 = 0;
      localCurve = padding / 2;
      curveY = fromIsBelow ? -localCurve : localCurve;
    }
    const down2 = endY - curveY;
    const left = to.x - padding;

    return `M ${startX} ${startY} v ${down1} a ${localCurve} ${localCurve} 0 0 1 ${-localCurve} ${localCurve} H ${left} a ${localCurve} ${localCurve} 0 0 ${clockwise} ${-localCurve} ${curveY} V ${down2} a ${localCurve} ${localCurve} 0 0 ${clockwise} ${localCurve} ${curveY} L ${endX} ${endY} m -5 -5 l 5 5 l -5 5`;
  }

  // Simple path: go down then curve to target
  let localCurve = curve;
  if (endX < startX + localCurve) localCurve = Math.max(endX - startX, 0);
  const offset = fromIsBelow ? endY + localCurve : endY - localCurve;

  return `M ${startX} ${startY} V ${offset} a ${localCurve} ${localCurve} 0 0 ${clockwise} ${localCurve} ${curveY} L ${endX} ${endY} m -5 -5 l 5 5 l -5 5`;
}

// Arrowhead is built into the path (m -5 -5 l 5 5 l -5 5), no separate function needed
export function getArrowHeadPath(_to: TaskPosition): string {
  return ''; // arrowhead is embedded in getArrowPath
}

// ── Today marker ──────────────────────────────────────────────────────────────

/**
 * Returns the X position of today's date, or null if outside the range.
 */
export function getTodayX(range: TimeRange, viewMode: ViewMode): number | null {
  const today = startOfDay(new Date());
  if (today < range.start || today > range.end) return null;
  return dateToX(today, range, viewMode);
}

// ── Text color contrast ───────────────────────────────────────────────────────

/**
 * Returns '#1a1a1a' (dark) or '#ffffff' (light) for WCAG contrast
 * against the given hex background color.
 */
export function getTextColor(bgColor: string): string {
  // Strip leading #
  const hex = bgColor.replace(/^#/, '');
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
}

// ── GanttLineaObra → GanttTask mapper ────────────────────────────────────────

export interface GanttLineaObra {
  id: string;
  nombre: string;
  duracionDias: number;
  orden: number;
  color: string;
  dependeDe?: string[];
  descripcion?: string;
  fechaInicio?: string;
  fechaFin?: string;
  completada?: boolean;
  fechaInicioReal?: string;
  fechaFinReal?: string;
}

/**
 * Map a GanttLineaObra (domain model) to a GanttTask (chart model).
 * When fechaInicio/fechaFin are missing, falls back to today + duration.
 */
export function toGanttTask(linea: GanttLineaObra): GanttTask {
  const today = startOfDay(new Date());
  const start = linea.fechaInicio
    ? linea.fechaInicio
    : format(today, 'yyyy-MM-dd');
  const end = linea.fechaFin
    ? linea.fechaFin
    : format(addDays(today, linea.duracionDias), 'yyyy-MM-dd');

  return {
    id: linea.id,
    name: linea.nombre,
    start,
    end,
    durationDays: linea.duracionDias,
    progress: linea.completada ? 100 : 0,
    dependencies: linea.dependeDe,
    color: linea.color,
    description: linea.descripcion,
    completed: linea.completada,
    actualStart: linea.fechaInicioReal,
    actualEnd: linea.fechaFinReal,
  };
}

// ── Format helpers ────────────────────────────────────────────────────────────

/**
 * Format a date in Spanish (es-AR) locale: "5 mar. 2025"
 */
export function formatDateES(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleDateString('es-AR', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
