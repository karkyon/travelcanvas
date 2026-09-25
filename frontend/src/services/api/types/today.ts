/**
 * 当日モード(NOW/NEXT、FR-029)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。
 * [Gate L1b] 実効開始時刻の出所・到着予定へ向かう移動区間(出発時刻・遅延状況)・
 * 端末側再計算用の今日の予定一覧を追加(backend/app/api/v1/plans.py TodayResponse)。
 */
export type TodayTimeSource = 'start_at' | 'local_start_time';
export type TodayTransportStatus = 'unknown' | 'on_time' | 'delayed' | 'cancelled';

export interface TodayEvent {
  id: string;
  title: string;
  event_type: string;
  start_at: string | null;
  end_at: string | null;
  local_start_time: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  has_ticket: boolean;
  reservation_id: string | null;
  /** start_atは当日表示用の実効開始時刻。local_start_timeのみの予定は日程のタイムゾーンで解釈した値。 */
  time_source: TodayTimeSource | null;
  departure_at: string | null;
  transport_mode: string | null;
  transport_status: TodayTransportStatus | null;
}

export interface TodayResponse {
  plan_id: string;
  today_date: string | null;
  timezone_id: string | null;
  server_time: string;
  now_event: TodayEvent | null;
  next_event: TodayEvent | null;
  minutes_until_next: number | null;
  /** 「今日」の現地日付が終わる時刻(UTC)。今日の日程が無ければnull。 */
  day_end_at: string | null;
  /** 今日の時刻付き予定(と前日から継続中の予定)。実効開始時刻順。 */
  events: TodayEvent[];
}
