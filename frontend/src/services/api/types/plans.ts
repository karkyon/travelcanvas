/**
 * 正規化Plan/Day/Event API(/plans)の型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
// [Gate #31.5C] 正規化Plan/Day/Event API (/plans) のレスポンス型
export interface NormalizedEvent {
  id: string;
  day_id: string;
  title: string;
  description?: string | null;
  event_type: string;
  start_at?: string | null;
  end_at?: string | null;
  local_start_time?: string | null;
  is_all_day: boolean;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  locked: boolean;
  sort_order: number;
  place_id?: string | null;
}

export interface NormalizedDay {
  id: string;
  local_date: string;
  timezone_id: string;
  title?: string | null;
  notes?: string | null;
  sort_order: number;
  events?: NormalizedEvent[];
}

/**
 * [Gate M9-FE-C2b-3] POST /quick-drafts/{id}/promote の応答(backend quickdrafts.py response_body)。
 * start_date/end_dateは未設定時にnullになる。
 */
export interface PromoteQuickDraftResult {
  id: string;
  revision: number;
  title?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  quick_draft_id: string;
  quick_draft_status: string;
}

export interface NormalizedPlanDetail {
  id: string;
  title: string;
  revision: number;
  days: NormalizedDay[];
}
