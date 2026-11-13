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
  if (!c.local_date) return '日付なし';
  return `${c.local_date} ${c.is_all_day ? '終日' : (c.local_start_time ?? '時刻未定')}`;
}

/** [Gate Remaining-1] 取り込み案の種類の言葉 */
export const ACTION_TEXT: Record<'create' | 'update' | 'delete' | 'candidate', string> = {
  create: '追加', update: '変更', delete: '削除', candidate: '候補箱へ',
};
/** 予定にしなかった物の言葉 */
export const SHAPE_TEXT: Record<'track' | 'no_position' | 'bad_row', string> = {
  track: '線(経路・軌跡)', no_position: '位置の無い地点', bad_row: '読めない行',
};

export const selectable = (c: CalendarImportCandidate): boolean => c.action !== 'skip';

export function toApplyItems(candidates: CalendarImportCandidate[], selected: Set<number>): CalendarImportApplyItem[] {
  return candidates
    .filter((c) => selectable(c) && selected.has(c.index))
    .map((c) => ({
      action: c.action as CalendarImportApplyItem['action'], event_id: c.event_id, title: c.title, local_date: c.local_date,
      local_start_time: c.local_start_time, is_all_day: c.is_all_day, address: c.address,
      latitude: c.latitude ?? null, longitude: c.longitude ?? null, note: c.note ?? null,
    }));
}
