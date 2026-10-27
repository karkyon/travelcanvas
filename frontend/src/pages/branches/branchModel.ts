/**
 * [Gate P7] What-if・旅程ブランチ(FR-019)の表示名・入力検証・整形。
 *
 * backend(app/services/branches.py、branch-v1)の規則に合わせる:
 *   - 遅延: 日・開始時刻(HH:MM)・15〜720分。体力: 1日1〜10件。予算: 1〜90%
 *   - 分岐案の予定は本案の予定を欠かさず(外す場合は removed)、時刻はHH:MM、題名1〜200文字
 *   - 採用できない理由(conflicts)があれば採用しない(本案を黙って上書きしない)
 */
import type {
  BranchConflict, BranchContentInput, BranchCreateData, BranchDetail, BranchEventItem, BranchOp, BranchScenario,
  BranchState,
} from '@/services/api';

export const SCENARIO_OPTIONS: { value: BranchScenario; label: string; help: string }[] = [
  { value: 'rain', label: '雨天', help: '屋外の予定に注意を付けます(予定は外しません)' },
  { value: 'delay', label: '遅延', help: '指定した日の指定時刻以降の予定を遅らせます' },
  { value: 'fatigue', label: '体力・疲労', help: '1日の予定数の上限を超える予定を外す候補にします' },
  { value: 'absence', label: '欠席', help: '参加できない人がいる場合の案を作ります(予定はそのまま)' },
  { value: 'budget', label: '予算削減', help: '予算を減らす場合の案を作ります(予定はそのまま)' },
  { value: 'custom', label: '自由', help: '本案をそのまま写して自由に組み替えます' },
];
export const SCENARIO_LABEL = Object.fromEntries(SCENARIO_OPTIONS.map((o) => [o.value, o.label])) as Record<BranchScenario, string>;

export const STATE_LABEL: Record<BranchState, string> = {
  draft: '検討中', adopted: '採用済み', adopted_undone: '採用後に取り消し', discarded: '見送り',
};

const FIELD_LABEL: Record<string, string> = {
  day_id: '日付', title: '予定名', event_type: '種類', local_start_time: '開始時刻', is_all_day: '終日',
  sort_order: '並び順', local_date: '日付',
};
export const fieldLabel = (f: string): string => FIELD_LABEL[f] ?? f;

const CONFLICT_TEXT: Record<BranchConflict['reason'], string> = {
  changed_in_plan: '分岐した後に本案でも変更されています',
  deleted_in_plan: '本案では削除されています',
  locked: '本案で確定(ロック)されています',
  has_relations: '予約・移動区間などと紐付いているため、このままでは外せません(この案の「移動区間・予約」で区間を外すか予約を付け替えてください)',
  day_missing: '移動先の日程が本案にありません',
  event_missing: 'つなぐ予定が本案にありません',
  already_cancelled: '本案で既に取消になっています',
  hidden: '見せない設定の項目に、本案と食い違う変更があります',
};

const SEGMENT_FIELD_LABEL: Record<string, string> = {
  mode: '移動手段', status: '状態', duration_minutes: '所要時間', distance_km: '距離', cost: '費用', currency: '通貨',
  planned_departure_at: '出発', planned_arrival_at: '到着', last_departure_at: '最終の便', transport_number: '便名',
  platform: '番線', preparation_minutes: '準備', buffer_before_minutes: '余裕', from_event_id: '出発の予定',
  to_event_id: '到着の予定', event_ids: '紐付く予定',
};

export function describeConflict(c: BranchConflict): string {
  if (c.kind === 'segment' || c.kind === 'reservation') {
    const target = c.kind === 'segment' ? '移動区間' : `予約「${c.label ?? '予約'}」`;
    const fields = c.fields && c.fields.length > 0
      ? `(${c.fields.map((f) => SEGMENT_FIELD_LABEL[f] ?? f).join('・')})` : '';
    return `${target}: ${CONFLICT_TEXT[c.reason]}${fields}`;
  }
  const target = c.title ?? '追加した予定';
  const fields = c.fields && c.fields.length > 0 ? `(${c.fields.map(fieldLabel).join('・')})` : '';
  return `「${target}」: ${CONFLICT_TEXT[c.reason]}${fields}`;
}

export function describeOp(op: BranchOp, dayLabel: (id: string) => string): string {
  if (op.op === 'add') return `追加: ${String(op.fields?.title ?? '')}`;
  if (op.op === 'remove') return `外す: ${op.title ?? ''}`;
  const parts = Object.entries(op.fields ?? {}).map(([k, v]) => {
    const before = op.before?.[k as keyof typeof op.before];
    const show = (x: unknown) => (k === 'day_id' ? dayLabel(String(x)) : x === null || x === undefined ? '未定' : String(x));
    return `${fieldLabel(k)} ${show(before)} → ${show(v)}`;
  });
  return `変更: ${op.title ?? ''}(${parts.join('、')})`;
}

export interface CreateForm {
  title: string;
  scenario_type: BranchScenario;
  note: string;
  day_id: string;
  after: string;
  minutes: string;
  max_events_per_day: string;
  budget_cut_percent: string;
  absent_member: string;
}

export const emptyCreateForm = (): CreateForm => ({
  title: '', scenario_type: 'rain', note: '', day_id: '', after: '', minutes: '60', max_events_per_day: '3',
  budget_cut_percent: '20', absent_member: '',
});

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const intIn = (raw: string, min: number, max: number): number | null => {
  if (!/^\d+$/.test(raw.trim())) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
};

export function createFormToPayload(f: CreateForm): Result<BranchCreateData> {
  const title = f.title.trim();
  if (!title) return { ok: false, error: '題名を入力してください' };
  const assumptions: BranchCreateData['assumptions'] = {};
  if (f.note.trim()) assumptions.note = f.note.trim();
  if (f.scenario_type === 'delay') {
    if (!f.day_id) return { ok: false, error: '遅延を想定する日を選んでください' };
    const minutes = intIn(f.minutes, 15, 720);
    if (minutes === null) return { ok: false, error: '遅延は15〜720分で入力してください' };
    if (f.after && !TIME_RE.test(f.after)) return { ok: false, error: '遅延が始まる時刻はHH:MMで入力してください' };
    Object.assign(assumptions, { day_id: f.day_id, minutes, ...(f.after ? { after: f.after } : {}) });
  } else if (f.scenario_type === 'fatigue') {
    const n = intIn(f.max_events_per_day, 1, 10);
    if (n === null) return { ok: false, error: '1日の予定数の上限は1〜10で入力してください' };
    assumptions.max_events_per_day = n;
  } else if (f.scenario_type === 'budget') {
    const n = intIn(f.budget_cut_percent, 1, 90);
    if (n === null) return { ok: false, error: '予算の削減率は1〜90%で入力してください' };
    assumptions.budget_cut_percent = n;
  } else if (f.scenario_type === 'absence' && f.absent_member.trim()) {
    assumptions.absent_member = f.absent_member.trim().slice(0, 100);
  }
  return { ok: true, data: { title, scenario_type: f.scenario_type, assumptions } };
}

/** 分岐案の予定(編集中)→ 送信内容。検証に失敗したら理由を返す。 */
export function contentToPayload(items: BranchEventItem[]): Result<BranchContentInput[]> {
  const out: BranchContentInput[] = [];
  for (const [i, it] of items.entries()) {
    const title = it.title.trim();
    if (!title) return { ok: false, error: `${i + 1}件目: 予定名を入力してください` };
    if (it.local_start_time && !TIME_RE.test(it.local_start_time)) {
      return { ok: false, error: `「${title}」の時刻はHH:MMで入力してください` };
    }
    out.push({
      key: it.key, source_event_id: it.source_event_id, day_id: it.day_id, title, event_type: it.event_type,
      local_start_time: it.local_start_time || null, is_all_day: it.is_all_day, sort_order: it.sort_order,
      removed: it.source_event_id ? it.removed : false, note: it.note,
    });
  }
  return { ok: true, data: out };
}

/** 日ごとに、並び順・時刻順で並べる */
export function groupByDay(detail: Pick<BranchDetail, 'days'>, items: BranchEventItem[]) {
  return detail.days.map((d) => ({
    day: d,
    items: items
      .filter((i) => i.day_id === d.id)
      .sort((a, b) => (a.local_start_time ?? '99:99').localeCompare(b.local_start_time ?? '99:99') || a.sort_order - b.sort_order),
  }));
}

export function newItem(dayId: string, sortOrder: number): BranchEventItem {
  return {
    key: `new-${Math.random().toString(36).slice(2, 10)}`, source_event_id: null, day_id: dayId, title: '',
    event_type: 'activity', local_start_time: null, is_all_day: false, sort_order: sortOrder, locked: false,
    removed: false, note: null,
  };
}
