/** [Gate G9] UX-4 文脈型ダッシュボードの応答の decoder(g9.ts 経由で読む。最初に読む JS に入れない) */
import type {
  DashboardAlerts, DashboardEvent, DashboardFocus, DashboardReadiness, DashboardSummary, DashboardToday, DashboardTrip,
  TripPhase,
} from './types/g9';
import { arrayOf, bool, decodeResponse, int, nonNegativeInt, nullable, object, oneOf, str, type Decoder } from './decode';

const phase = oneOf('ongoing', 'upcoming', 'past', 'undated');

const trip: Decoder<DashboardTrip> = object<DashboardTrip>({
  id: str, title: str, destination: nullable(str), role: oneOf('owner', 'editor', 'viewer'), can_edit: bool,
  start_date: nullable(str), end_date: nullable(str), timezone_id: str, local_today: str, day_count: nonNegativeInt,
  total_days: nullable(nonNegativeInt), phase, days_until_start: nullable(int), day_number: nullable(int),
  days_since_end: nullable(int), member_count: nonNegativeInt, created_at: nullable(str),
});

const event: Decoder<DashboardEvent> = object<DashboardEvent>({
  id: str, title: str, event_type: str, start_at: nullable(str), end_at: nullable(str), local_start_time: nullable(str),
  has_ticket: bool, reservation_id: nullable(str), departure_at: nullable(str), transport_mode: nullable(str),
  transport_status: nullable(str),
});

const today: Decoder<DashboardToday> = object<DashboardToday>({
  today_date: nullable(str), timezone_id: nullable(str), now_event: nullable(event), next_event: nullable(event),
  minutes_until_next: nullable(int), event_count: nonNegativeInt,
});

const readiness: Decoder<DashboardReadiness> = object<DashboardReadiness>({
  is_ready: bool, total: nonNegativeInt, high: nonNegativeInt,
  top: arrayOf(object<DashboardReadiness['top'][number]>({
    title: nullable(str), severity: nullable(str), link: nullable(str), due_at: nullable(str),
  })),
});

const alerts: Decoder<DashboardAlerts> = object<DashboardAlerts>({
  active: nonNegativeInt, detected: nonNegativeInt,
  top: arrayOf(object<DashboardAlerts['top'][number]>({
    kind_label: nullable(str), event_title: nullable(str), delay_minutes: nullable(int), is_stale: nullable(bool),
  })),
});

const focus: Decoder<DashboardFocus> = object<DashboardFocus>({
  plan_id: str, phase, today: nullable(today), readiness: nullable(readiness), alerts: nullable(alerts),
});

const counts: Decoder<Record<TripPhase, number>> = object<Record<TripPhase, number>>({
  ongoing: nonNegativeInt, upcoming: nonNegativeInt, past: nonNegativeInt, undated: nonNegativeInt,
});

export const dashboardSummary: Decoder<DashboardSummary> = object<DashboardSummary>({
  server_time: str, is_guest: bool, trips: arrayOf(trip), counts, focus: nullable(focus), limit: nonNegativeInt,
  algorithm_version: str,
});

export function decodeDashboard(raw: unknown): DashboardSummary {
  return decodeResponse(raw, dashboardSummary, 'GET /dashboard');
}
