/**
 * 当日モード(NOW/NEXT、FR-029)APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
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
}

export interface TodayResponse {
  plan_id: string;
  today_date: string | null;
  timezone_id: string | null;
  server_time: string;
  now_event: TodayEvent | null;
  next_event: TodayEvent | null;
  minutes_until_next: number | null;
}
