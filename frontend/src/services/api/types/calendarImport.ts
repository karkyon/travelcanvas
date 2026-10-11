/**
 * カレンダー(ICS)の取込(FR-036)APIの型
 *
 * [Gate P8] backend/app/api/v1/calendar_import.py・app/services/calendar_import.py に対応する。
 * プレビューはDBを変えない。適用は1つの変更セットで、本案の「元に戻す」で取り消せる。
 */
export type CalendarImportAction = 'create' | 'update' | 'skip';
export type CalendarImportSkipReason = 'recurring' | 'cancelled' | 'unchanged' | 'locked' | 'duplicate' | 'no_day';
export type CalendarImportField = 'title' | 'local_date' | 'local_start_time' | 'is_all_day' | 'address';

export interface CalendarImportCandidate {
  index: number;
  uid: string | null;
  title: string;
  local_date: string;
  local_start_time: string | null;
  is_all_day: boolean;
  address: string | null;
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
  create_missing_days: boolean;
  summary: {
    total: number; create: number; update: number; skip: number;
    skipped_by_reason: Partial<Record<CalendarImportSkipReason, number>>;
  };
  candidates: CalendarImportCandidate[];
}

export interface CalendarImportApplyItem {
  action: 'create' | 'update';
  event_id?: string | null;
  title: string;
  local_date: string;
  local_start_time: string | null;
  is_all_day: boolean;
  address: string | null;
}

export interface CalendarImportResult {
  plan_revision: number;
  created: number;
  updated: number;
  created_days: number;
}
