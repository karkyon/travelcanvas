/**
 * [Gate P8] カレンダー(ICS)取込画面の表示文言・送信内容。
 */
import type { CalendarImportApplyItem, CalendarImportCandidate, CalendarImportSkipReason } from '@/services/api';

export const SKIP_REASON_TEXT: Record<CalendarImportSkipReason, string> = {
  recurring: '繰り返しの予定は取り込めません',
  cancelled: '取り消された予定です',
  unchanged: '本案と同じです',
  locked: '本案で確定済みのため変更しません',
  duplicate: '同じ日時・同じ名前の予定が既にあります',
  no_day: 'この日の日程がありません',
};

const FIELD_TEXT: Record<string, string> = {
  title: '予定名', local_date: '日付', local_start_time: '開始時刻', is_all_day: '終日', address: '場所',
};

const show = (v: unknown) => (v === null || v === undefined || v === '' ? '未設定' : v === true ? 'はい' : v === false ? 'いいえ' : String(v));

export function describeChanges(c: CalendarImportCandidate): string {
  return Object.entries(c.changes ?? {})
    .map(([k, v]) => `${FIELD_TEXT[k] ?? k} ${show(v?.before)} → ${show(v?.after)}`)
    .join('、');
}

export function describeWhen(c: CalendarImportCandidate): string {
  return `${c.local_date} ${c.is_all_day ? '終日' : (c.local_start_time ?? '時刻未定')}`;
}

export const selectable = (c: CalendarImportCandidate): boolean => c.action !== 'skip';

export function toApplyItems(candidates: CalendarImportCandidate[], selected: Set<number>): CalendarImportApplyItem[] {
  return candidates
    .filter((c) => selectable(c) && selected.has(c.index))
    .map((c) => ({
      action: c.action as 'create' | 'update', event_id: c.event_id, title: c.title, local_date: c.local_date,
      local_start_time: c.local_start_time, is_all_day: c.is_all_day, address: c.address,
    }));
}
