/**
 * [Gate P1] 準備画面(持ち物 FR-025 / 準備タスク・レディネス FR-026)の表示整形と入力変換。
 *
 * 画面(PreparationPage)から分離した純粋関数。backend(app/api/v1/preparation.py)の規則に合わせる:
 *   - 持ち物の名前は1〜120文字、数量は1〜999
 *   - タスクの題名は1〜200文字、期限はタイムゾーン付き日時
 *   - 個人の持ち物には担当者を付けない(本人が用意する)
 */
import type {
  PackingCategory, PackingItem, PackingItemCreateData, PackingScope, PackingStatus, PreparationTask,
  PreparationTaskCreateData, Readiness, ReadinessCategory, ReadinessSeverity,
} from '@/services/api';

export const CATEGORY_OPTIONS: { value: PackingCategory; label: string }[] = [
  { value: 'clothing', label: '衣類' },
  { value: 'toiletries', label: '洗面・衛生' },
  { value: 'health', label: '薬・健康' },
  { value: 'documents', label: '書類・チケット' },
  { value: 'electronics', label: '電子機器' },
  { value: 'money', label: 'お金' },
  { value: 'gear', label: '道具' },
  { value: 'other', label: 'その他' },
];

export const STATUS_OPTIONS: { value: PackingStatus; label: string }[] = [
  { value: 'to_prepare', label: '未準備' },
  { value: 'to_buy', label: '要購入' },
  { value: 'packed', label: '梱包済み' },
  { value: 'after_use', label: '使用後・片付け済み' },
];

const CATEGORY_LABEL = Object.fromEntries(CATEGORY_OPTIONS.map((o) => [o.value, o.label])) as Record<PackingCategory, string>;
const STATUS_LABEL = Object.fromEntries(STATUS_OPTIONS.map((o) => [o.value, o.label])) as Record<PackingStatus, string>;

export const categoryLabel = (c: PackingCategory): string => CATEGORY_LABEL[c] ?? c;
export const statusLabel = (s: PackingStatus): string => STATUS_LABEL[s] ?? s;

export const READINESS_CATEGORY_LABEL: Record<ReadinessCategory, string> = {
  unreserved: '未予約',
  unconfirmed: '未確認',
  unpaid: '未支払',
  deadline: '期限',
  unassigned: '未割当',
  packing: '持ち物不足',
};

export const SEVERITY_LABEL: Record<ReadinessSeverity, string> = { high: '要対応', medium: '確認', low: '軽微' };

/** 梱包済み(または使用後)の持ち物か */
export const isReady = (item: PackingItem): boolean => item.status === 'packed' || item.status === 'after_use';

/** 持ち物をカテゴリごとにまとめる(backendの並び順=カテゴリ順を保つ) */
export function groupByCategory(items: PackingItem[]): { category: PackingCategory; label: string; items: PackingItem[] }[] {
  const groups: { category: PackingCategory; label: string; items: PackingItem[] }[] = [];
  for (const opt of CATEGORY_OPTIONS) {
    const inGroup = items.filter((i) => i.category === opt.value);
    if (inGroup.length > 0) groups.push({ category: opt.value, label: opt.label, items: inGroup });
  }
  return groups;
}

export function packingProgress(items: PackingItem[]): { packed: number; total: number; requiredLeft: number } {
  return {
    packed: items.filter(isReady).length,
    total: items.length,
    requiredLeft: items.filter((i) => i.is_required && !isReady(i)).length,
  };
}

/**
 * 準備状況の要約文。「確認していない」「問題なし」を混同しない:
 * 項目が0件のときだけ「準備は整っています」と表示する。
 */
export function readinessSummary(r: Readiness | null): { tone: 'ready' | 'attention' | 'unknown'; text: string } {
  if (!r) return { tone: 'unknown', text: '準備状況をまだ取得していません。' };
  if (r.is_ready) {
    const resolved = r.resolved_by_tasks > 0 ? `(タスクで対応済み ${r.resolved_by_tasks}件)` : '';
    return { tone: 'ready', text: `出発前に対応が必要な項目はありません${resolved}。` };
  }
  const high = r.counts.by_severity.high;
  const head = high > 0 ? `要対応${high}件を含む` : '';
  return { tone: 'attention', text: `${head}${r.counts.total}件の準備が残っています。` };
}

export interface PackingForm {
  name: string;
  note: string;
  category: PackingCategory;
  quantity: string;
  is_required: boolean;
  status: PackingStatus;
  scope: PackingScope;
  assignee_user_id: string;
}

export const emptyPackingForm = (): PackingForm => ({
  name: '', note: '', category: 'other', quantity: '1', is_required: false, status: 'to_prepare', scope: 'shared',
  assignee_user_id: '',
});

export function packingFormFromItem(item: PackingItem): PackingForm {
  return {
    name: item.name ?? '',
    note: item.note ?? '',
    category: item.category,
    quantity: String(item.quantity),
    is_required: item.is_required,
    status: item.status,
    scope: item.scope,
    assignee_user_id: item.assignee_user_id ?? '',
  };
}

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

export function packingFormToPayload(form: PackingForm): Result<PackingItemCreateData> {
  const name = form.name.trim();
  if (!name) return { ok: false, error: '名前を入力してください' };
  if (name.length > 120) return { ok: false, error: '名前は120文字以内で入力してください' };
  const quantity = Number(form.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
    return { ok: false, error: '数量は1〜999の整数で入力してください' };
  }
  const data: PackingItemCreateData = {
    name,
    category: form.category,
    quantity,
    is_required: form.is_required,
    status: form.status,
    scope: form.scope,
  };
  const note = form.note.trim();
  if (note) data.note = note;
  if (form.scope === 'shared' && form.assignee_user_id) data.assignee_user_id = form.assignee_user_id;
  return { ok: true, data };
}

export interface TaskForm {
  title: string;
  description: string;
  completion_criteria: string;
  /** <input type="datetime-local"> の値(端末のタイムゾーンで解釈する) */
  due_local: string;
  assignee_user_id: string;
}

export const emptyTaskForm = (title = ''): TaskForm => ({
  title, description: '', completion_criteria: '', due_local: '', assignee_user_id: '',
});

/** "YYYY-MM-DDTHH:MM"(端末の現地時刻)→ タイムゾーン付きISO文字列。不正ならnull。 */
export function localToIso(local: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** タイムゾーン付きISO文字列 → "YYYY-MM-DDTHH:MM"(端末の現地時刻) */
export function isoToLocal(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function taskFormFromTask(t: PreparationTask): TaskForm {
  return {
    title: t.title,
    description: t.description ?? '',
    completion_criteria: t.completion_criteria ?? '',
    due_local: isoToLocal(t.due_at),
    assignee_user_id: t.assignee_user_id ?? '',
  };
}

export function taskFormToPayload(form: TaskForm): Result<PreparationTaskCreateData> {
  const title = form.title.trim();
  if (!title) return { ok: false, error: '題名を入力してください' };
  if (title.length > 200) return { ok: false, error: '題名は200文字以内で入力してください' };
  const data: PreparationTaskCreateData = { title };
  if (form.description.trim()) data.description = form.description.trim();
  if (form.completion_criteria.trim()) data.completion_criteria = form.completion_criteria.trim();
  if (form.due_local) {
    const iso = localToIso(form.due_local);
    if (!iso) return { ok: false, error: '期限の日時が正しくありません' };
    data.due_at = iso;
  }
  if (form.assignee_user_id) data.assignee_user_id = form.assignee_user_id;
  return { ok: true, data };
}

/** 期限の表示("11/3 18:00")。端末のタイムゾーンで表示する。 */
export function formatDue(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
