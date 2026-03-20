export interface GanttTask {
  id: string;
  name: string;
  start: string;            // ISO date (YYYY-MM-DD)
  end: string;              // ISO date
  durationDays: number;
  progress: number;         // 0-100
  dependencies?: string[];
  color?: string;
  description?: string;
  completed?: boolean;
  actualStart?: string;
  actualEnd?: string;
  isGroupHeader?: boolean;
  groupLabel?: string;
  section?: 'commercial' | 'technical';
}

export type ViewMode = 'Day' | 'Week' | 'Month' | 'Year';

export const VIEW_OPTIONS = [
  { value: 'Day',   label: 'Dia' },
  { value: 'Week',  label: 'Semana' },
  { value: 'Month', label: 'Mes' },
  { value: 'Year',  label: 'Año' },
] as const;

// Layout constants — full chart
export const ROW_HEIGHT = 40;
export const BAR_HEIGHT = 28;
export const BAR_RADIUS = 4;
export const HEADER_HEIGHT = 50;
export const BAR_Y_OFFSET = (ROW_HEIGHT - BAR_HEIGHT) / 2;

// Layout constants — mini variant
export const MINI_ROW_HEIGHT = 28;
export const MINI_BAR_HEIGHT = 20;
export const MINI_BAR_Y_OFFSET = (MINI_ROW_HEIGHT - MINI_BAR_HEIGHT) / 2;

// Column widths per view mode (px per unit)
export const COLUMN_WIDTHS: Record<ViewMode, number> = {
  Day: 40,
  Week: 120,
  Month: 200,
  Year: 80,
};
