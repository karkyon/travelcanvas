/** [Gate G9] UX-4 文脈型ダッシュボードの応答の decoder(g9.ts 経由で読む。最初に読む JS に入れない) */
import type {
  DashboardAlerts, DashboardEvent, DashboardFocus, DashboardHome, DashboardReadiness, DashboardSummary, DashboardToday,
  DashboardTrip, FootTrip, HomePlanning, HomeTask, HomeTimelineTrip, TripPhase, TripShelf,
} from './types/g9';
import { optionalPlanCover } from './g11cover';
import {
  arrayOf, bool, decodeResponse, int, nonNegativeInt, nullable, num, object, oneOf, optional, record, str, type Decoder,
} from './decode';

const phase = oneOf('ongoing', 'upcoming', 'past', 'undated');
const shelf = oneOf<TripShelf>('planning', 'considering', 'visited', 'cancelled');

const trip: Decoder<DashboardTrip> = object<DashboardTrip>({
  id: str, title: str, destination: nullable(str), role: oneOf('owner', 'editor', 'viewer'), can_edit: bool,
  start_date: nullable(str), end_date: nullable(str), timezone_id: str, local_today: str, day_count: nonNegativeInt,
  total_days: nullable(nonNegativeInt), phase, days_until_start: nullable(int), day_number: nullable(int),
  days_since_end: nullable(int), member_count: nonNegativeInt, created_at: nullable(str), cover: optionalPlanCover,
  shelf: optional(shelf), event_count: optional(nonNegativeInt), photo_count: optional(nonNegativeInt),
  note_count: optional(nonNegativeInt),
});

// [Gate HomeV2] ホーム v2
const task: Decoder<HomeTask> = object<HomeTask>({
  plan_id: str, trip_title: str, kind: str, severity: str, title: str, to: str, action: str,
});
const planning: Decoder<HomePlanning> = object<HomePlanning>({
  plan_id: str, event_count: nonNegativeInt,
  segments: object<HomePlanning['segments']>({ need: nonNegativeInt, done: nonNegativeInt }),
  steps: arrayOf(object<HomePlanning['steps'][number]>({ key: str, label: str, done: bool })),
  done: nonNegativeInt, total: nonNegativeInt, tasks: arrayOf(task),
});
const timelineTrip: Decoder<HomeTimelineTrip> = object<HomeTimelineTrip>({
  plan_id: str, title: str, start_date: nullable(str), end_date: nullable(str), photo_count: nonNegativeInt,
  note_count: nonNegativeInt, cover: optionalPlanCover,
  // [Gate MemoryReel] 行き先(表紙の絵の色)と思い出リールの札
  destination: optional(nullable(str)), reel_badge: optional(nullable(str)),
});
// [Gate FootHover] 足あとの地図のポップアップの旅行
const footTrip: Decoder<FootTrip> = object<FootTrip>({
  plan_id: str, title: str, start_date: nullable(str), end_date: nullable(str), state: oneOf('visited', 'planned'),
});
const footTripsByPref: Decoder<Record<string, FootTrip[]>> = (v, path) => {
  const r = record(v, path);
  return Object.fromEntries(Object.entries(r).map(([k, x]) => [k, arrayOf(footTrip)(x, `${path}.${k}`)]));
};
const home: Decoder<DashboardHome> = object<DashboardHome>({
  shelves: object<DashboardHome['shelves']>({
    planning: nonNegativeInt, considering: nonNegativeInt, visited: nonNegativeInt, cancelled: nonNegativeInt,
  }),
  planning: arrayOf(planning),
  tasks: arrayOf(task),
  memories: object<DashboardHome['memories']>({
    recent: nullable(object<NonNullable<DashboardHome['memories']['recent']>>({ plan_id: str, photo_ids: arrayOf(str) })),
    timeline: arrayOf(timelineTrip),
  }),
  footprints: object<DashboardHome['footprints']>({
    prefectures: arrayOf(str), planned_prefectures: arrayOf(str), all_prefectures: arrayOf(str),
    trips_visited: nonNegativeInt, days_this_year: nonNegativeInt, photos: nonNegativeInt,
    // [Gate Footprints2] 世界地図の点・海外の旅の数(古い応答には無い)
    points: optional(arrayOf(object<NonNullable<DashboardHome['footprints']['points']>[number]>({
      lat: num, lng: num, state: oneOf('visited', 'planned'), label: str, trips: optional(arrayOf(footTrip)), jp: optional(bool),
    }))),
    overseas_trips: optional(nonNegativeInt),
    pref_trips: optional(footTripsByPref),
  }),
  wishlist: object<DashboardHome['wishlist']>({
    count: nonNegativeInt,
    groups: arrayOf(object<DashboardHome['wishlist']['groups'][number]>({
      category: str, count: nonNegativeInt,
      spots: arrayOf(object<DashboardHome['wishlist']['groups'][number]['spots'][number]>({
        spot_id: str, name: str, prefecture: nullable(str),
      })),
    })),
  }),
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
  algorithm_version: str, home: optional(home),
});

export function decodeDashboard(raw: unknown): DashboardSummary {
  return decodeResponse(raw, dashboardSummary, 'GET /dashboard');
}
