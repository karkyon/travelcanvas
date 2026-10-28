/** [Gate G9] UX-4 文脈型ダッシュボード(GET /dashboard、backend/app/api/v1/dashboard.py)の型 */
import type { PlanCover } from './g11';
export type TripPhase = 'ongoing' | 'upcoming' | 'past' | 'undated';
export type TripRole = 'owner' | 'editor' | 'viewer';

export interface DashboardTrip {
  id: string;
  title: string;
  destination: string | null;
  role: TripRole;
  can_edit: boolean;
  start_date: string | null;
  end_date: string | null;
  timezone_id: string;
  local_today: string;
  day_count: number;
  total_days: number | null;
  phase: TripPhase;
  days_until_start: number | null;
  day_number: number | null;
  days_since_end: number | null;
  member_count: number;
  created_at: string | null;
  /** [Gate G11] 表紙の写真(見える人だけ。無ければ null) */
  cover: PlanCover | null;
}

export interface DashboardEvent {
  id: string;
  title: string;
  event_type: string;
  start_at: string | null;
  end_at: string | null;
  local_start_time: string | null;
  has_ticket: boolean;
  reservation_id: string | null;
  departure_at: string | null;
  transport_mode: string | null;
  transport_status: string | null;
}

export interface DashboardToday {
  today_date: string | null;
  timezone_id: string | null;
  now_event: DashboardEvent | null;
  next_event: DashboardEvent | null;
  minutes_until_next: number | null;
  event_count: number;
}

export interface DashboardReadiness {
  is_ready: boolean;
  total: number;
  high: number;
  top: Array<{ title: string | null; severity: string | null; link: string | null; due_at: string | null }>;
}

export interface DashboardAlerts {
  active: number;
  detected: number;
  top: Array<{ kind_label: string | null; event_title: string | null; delay_minutes: number | null; is_stale: boolean | null }>;
}

export interface DashboardFocus {
  plan_id: string;
  phase: TripPhase;
  today: DashboardToday | null;
  readiness: DashboardReadiness | null;
  alerts: DashboardAlerts | null;
}

export interface DashboardSummary {
  server_time: string;
  is_guest: boolean;
  trips: DashboardTrip[];
  counts: Record<TripPhase, number>;
  focus: DashboardFocus | null;
  limit: number;
  algorithm_version: string;
}
