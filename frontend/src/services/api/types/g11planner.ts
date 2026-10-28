/** [Gate G11] 予定ごとの営業時間の照合(backend/app/services/hours_check.py の EventHours)の型 */
export type HoursStatus = 'ok' | 'near_close' | 'last_entry' | 'last_order' | 'closes_during' | 'closed' | 'unknown';

export interface EventHoursCheck {
  event_id: string;
  place_id: string | null;
  status: HoursStatus;
  /** within_hours / near_close / after_last_entry / after_last_order / closes_during_stay / closed_day / closed_special /
   *  before_open / after_close / no_place / no_time / no_hours / stale_source */
  reason: string;
  local_date: string | null;
  window_label: string | null;
  windows: string[];
  hours_source: string | null;
  last_entry: string | null;
  last_order: string | null;
  closes_at: string | null;
  minutes_to_close: number | null;
  estimated: boolean;
  stale: boolean;
  source: Record<string, unknown> | null;
}

export interface DayHoursCheck {
  day_id: string;
  local_date: string;
  timezone_id: string;
  near_minutes: number;
  stale_days: number;
  events: EventHoursCheck[];
}
