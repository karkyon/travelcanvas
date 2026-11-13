/**
 * カレンダー(ICS)の取込(FR-036)APIの型
 *
 * [Gate P8] backend/app/api/v1/calendar_import.py・app/services/calendar_import.py に対応する。
 * プレビューはDBを変えない。適用は1つの変更セットで、本案の「元に戻す」で取り消せる。
 */
/** [Gate Remaining-1] delete: 書き出した予定が他で取り消された / candidate: 日付の無い地点を候補箱へ */
export type CalendarImportAction = 'create' | 'update' | 'delete' | 'candidate' | 'skip';
export type CalendarImportSkipReason = 'recurring' | 'cancelled' | 'unchanged' | 'locked' | 'duplicate' | 'no_day';
export type CalendarImportField = 'title' | 'local_date' | 'local_start_time' | 'is_all_day' | 'address';

export interface CalendarImportCandidate {
  index: number;
  uid: string | null;
  title: string;
  /** 候補箱に入れる案(candidate)は日付が無い */
  local_date: string | null;
  local_start_time: string | null;
  is_all_day: boolean;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  note?: string | null;
  action: CalendarImportAction;
  reason: CalendarImportSkipReason | null;
  event_id: string | null;
  changes: Partial<Record<CalendarImportField, { before: unknown; after: unknown }>> | null;
  day_exists: boolean;
}

export interface CalendarImportPreview {
  plan_id: string;
  plan_revision: number;
  timezone_id: string;
  /** [Gate Remaining-1] 読んだファイルの形式 */
  format?: 'ics' | 'gpx' | 'kml' | 'csv';
  create_missing_days: boolean;
  summary: {
    total: number; create: number; update: number; skip: number;
    delete?: number; candidate?: number;
    skipped_by_reason: Partial<Record<CalendarImportSkipReason, number>>;
    /** 予定にしなかった線(経路・軌跡)・位置の無い地点・読めない行の数 */
    skipped_shapes?: Partial<Record<'track' | 'no_position' | 'bad_row', number>>;
  };
  candidates: CalendarImportCandidate[];
}

export interface CalendarImportApplyItem {
  action: 'create' | 'update' | 'delete' | 'candidate';
  event_id?: string | null;
  title: string;
  local_date: string | null;
  local_start_time: string | null;
  is_all_day: boolean;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  note?: string | null;
}

export interface CalendarImportResult {
  plan_revision: number;
  created: number;
  updated: number;
  created_days: number;
  deleted?: number;
  candidates?: number;
}
