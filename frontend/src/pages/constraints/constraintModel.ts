/**
 * [Gate L2] 制約画面(FR-016)の表示整形と、入力フォーム⇔APIデータの変換。
 *
 * 画面(ConstraintsPage)から分離した純粋関数。backend(app/api/v1/constraints.py)の
 * 値の規則に合わせる:
 *   - before/after: "HH:MM"。between: 開始と終了(日を跨いでよい)
 *   - max/min: 0以上の数値＋単位
 *   - equals/not_equals/avoid/prefer: 1〜200文字
 *   - hardは重みなし、softは1〜100
 */
import type {
  ConstraintCreateData, ConstraintHardness, ConstraintOperator, ConstraintPrivacyLevel, ConstraintScopeType,
  ConstraintType, PlanConstraint,
} from '@/services/api';

export const TYPE_OPTIONS: { value: ConstraintType; label: string; hardness: ConstraintHardness; operator: ConstraintOperator }[] = [
  { value: 'reservation', label: '予約(時刻固定)', hardness: 'hard', operator: 'equals' },
  { value: 'opening_hours', label: '営業時間', hardness: 'hard', operator: 'between' },
  { value: 'last_transport', label: '終電・最終便', hardness: 'hard', operator: 'before' },
  { value: 'meeting', label: '集合', hardness: 'hard', operator: 'before' },
  { value: 'budget_limit', label: '予算上限', hardness: 'hard', operator: 'max' },
  { value: 'forbidden', label: '不可条件', hardness: 'hard', operator: 'avoid' },
  { value: 'preference', label: '希望', hardness: 'soft', operator: 'prefer' },
  { value: 'fatigue', label: '疲労(移動・歩行の上限)', hardness: 'soft', operator: 'max' },
  { value: 'scenery', label: '景観', hardness: 'soft', operator: 'prefer' },
  { value: 'meal_interval', label: '食事の間隔', hardness: 'soft', operator: 'max' },
  { value: 'avoid_transport', label: '避けたい移動手段', hardness: 'soft', operator: 'avoid' },
  { value: 'priority', label: '優先したいこと', hardness: 'soft', operator: 'prefer' },
];

const DEFAULT_PRESET = { value: 'budget_limit' as ConstraintType, label: '予算上限', hardness: 'hard' as ConstraintHardness, operator: 'max' as ConstraintOperator };

export const OPERATOR_OPTIONS: { value: ConstraintOperator; label: string }[] = [
  { value: 'before', label: 'この時刻より前' },
  { value: 'after', label: 'この時刻より後' },
  { value: 'between', label: 'この時間帯の間' },
  { value: 'max', label: '上限' },
  { value: 'min', label: '下限' },
  { value: 'equals', label: 'この値に一致' },
  { value: 'not_equals', label: 'この値以外' },
  { value: 'avoid', label: '避ける' },
  { value: 'prefer', label: '優先する' },
];

export const UNIT_OPTIONS = ['JPY', 'USD', 'EUR', 'minutes', 'hours', 'km', 'count'] as const;

const UNIT_LABEL: Record<string, string> = {
  JPY: '円', USD: 'USドル', EUR: 'ユーロ', minutes: '分', hours: '時間', km: 'km', count: '回',
};

const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));

export type OperatorKind = 'time' | 'number' | 'text';

export function operatorKind(operator: ConstraintOperator): OperatorKind {
  if (operator === 'before' || operator === 'after' || operator === 'between') return 'time';
  if (operator === 'max' || operator === 'min') return 'number';
  return 'text';
}

export function typeLabel(type: ConstraintType | null): string {
  return type ? TYPE_LABEL[type] ?? type : '';
}

export function unitLabel(unit: string | null): string {
  return unit ? UNIT_LABEL[unit] ?? unit : '';
}

/** 値を人が読める一文にする(例: "上限 50000 円"、"22:00〜02:00 の間")。 */
export function describeCondition(c: Pick<PlanConstraint, 'operator' | 'value'>): string {
  if (!c.operator || !c.value) return '';
  const v = c.value.value ?? '';
  switch (c.operator) {
    case 'before': return `${v} より前`;
    case 'after': return `${v} より後`;
    case 'between': return `${v}〜${c.value.value_to ?? ''} の間`;
    case 'max': return `上限 ${v} ${unitLabel(c.value.unit)}`.trim();
    case 'min': return `下限 ${v} ${unitLabel(c.value.unit)}`.trim();
    case 'equals': return `「${v}」に一致`;
    case 'not_equals': return `「${v}」以外`;
    case 'avoid': return `「${v}」を避ける`;
    case 'prefer': return `「${v}」を優先`;
    default: return String(v);
  }
}

export function describeScope(c: Pick<PlanConstraint, 'scope_type' | 'scope_label' | 'scope_missing'>): string {
  if (c.scope_type === 'plan') return 'プラン全体';
  const prefix = c.scope_type === 'day' ? '日' : c.scope_type === 'event' ? 'イベント' : '個人';
  if (c.scope_missing) return `${prefix}: (対象は削除されています)`;
  return c.scope_label ? `${prefix}: ${c.scope_label}` : prefix;
}

// ===== フォーム =====

export interface ConstraintForm {
  title: string;
  constraint_type: ConstraintType;
  hardness: ConstraintHardness;
  operator: ConstraintOperator;
  value: string;
  value_to: string;
  unit: string;
  weight: string;
  scope_type: ConstraintScopeType;
  scope_id: string;
  privacy_level: ConstraintPrivacyLevel;
  is_active: boolean;
  reason: string;
}

export function emptyForm(type: ConstraintType = 'budget_limit'): ConstraintForm {
  const preset = TYPE_OPTIONS.find((o) => o.value === type) ?? DEFAULT_PRESET;
  return {
    title: '',
    constraint_type: preset.value,
    hardness: preset.hardness,
    operator: preset.operator,
    value: '',
    value_to: '',
    unit: operatorKind(preset.operator) === 'number' ? 'JPY' : '',
    weight: '50',
    scope_type: 'plan',
    scope_id: '',
    privacy_level: 'shared',
    is_active: true,
    reason: '',
  };
}

/** 種類を変えたときに、その種類で自然なhard/soft・条件を初期値として入れる(値は入力済みなら維持)。 */
export function applyTypePreset(form: ConstraintForm, type: ConstraintType): ConstraintForm {
  const preset = TYPE_OPTIONS.find((o) => o.value === type);
  if (!preset) return form;
  const kindChanged = operatorKind(preset.operator) !== operatorKind(form.operator);
  return {
    ...form,
    constraint_type: type,
    hardness: preset.hardness,
    operator: preset.operator,
    value: kindChanged ? '' : form.value,
    value_to: kindChanged ? '' : form.value_to,
    unit: operatorKind(preset.operator) === 'number' ? (form.unit || (type === 'budget_limit' ? 'JPY' : 'minutes')) : '',
  };
}

export function formFromConstraint(c: PlanConstraint): ConstraintForm {
  const base = emptyForm(c.constraint_type ?? 'budget_limit');
  return {
    ...base,
    title: c.title ?? '',
    constraint_type: c.constraint_type ?? base.constraint_type,
    hardness: c.hardness,
    operator: c.operator ?? base.operator,
    value: c.value?.value != null ? String(c.value.value) : '',
    value_to: c.value?.value_to ?? '',
    unit: c.value?.unit ?? '',
    weight: c.weight != null ? String(c.weight) : '50',
    scope_type: c.scope_type,
    scope_id: c.scope_type === 'member' ? '' : c.scope_id ?? '',
    privacy_level: c.privacy_level,
    is_active: c.is_active,
    reason: c.reason ?? '',
  };
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export type FormResult = { ok: true; data: ConstraintCreateData } | { ok: false; error: string };

/** フォームを検証してAPIへ送るデータへ変換する(サーバー側でも同じ規則で再検証される)。 */
export function formToPayload(form: ConstraintForm): FormResult {
  const title = form.title.trim();
  if (!title) return { ok: false, error: '題名を入力してください' };

  const kind = operatorKind(form.operator);
  let value: ConstraintCreateData['value'];
  if (kind === 'time') {
    if (!HHMM.test(form.value)) return { ok: false, error: '時刻を HH:MM で入力してください' };
    if (form.operator === 'between') {
      if (!HHMM.test(form.value_to)) return { ok: false, error: '終了時刻を HH:MM で入力してください' };
      if (form.value === form.value_to) return { ok: false, error: '開始と終了に同じ時刻は指定できません' };
      value = { value: form.value, value_to: form.value_to };
    } else {
      value = { value: form.value };
    }
  } else if (kind === 'number') {
    const n = Number(form.value);
    if (form.value.trim() === '' || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: '0以上の数値を入力してください' };
    }
    if (!form.unit.trim()) return { ok: false, error: '単位を選択してください' };
    value = { value: n, unit: form.unit.trim() };
  } else {
    const text = form.value.trim();
    if (!text || text.length > 200) return { ok: false, error: '値を1〜200文字で入力してください' };
    value = { value: text };
  }

  let weight: number | undefined;
  if (form.hardness === 'soft') {
    const w = Number(form.weight);
    if (!Number.isInteger(w) || w < 1 || w > 100) return { ok: false, error: '重みは1〜100の整数で入力してください' };
    weight = w;
  }

  if ((form.scope_type === 'day' || form.scope_type === 'event') && !form.scope_id) {
    return { ok: false, error: form.scope_type === 'day' ? '対象の日を選択してください' : '対象のイベントを選択してください' };
  }

  const data: ConstraintCreateData = {
    title,
    constraint_type: form.constraint_type,
    hardness: form.hardness,
    operator: form.operator,
    value,
    scope_type: form.scope_type,
    privacy_level: form.privacy_level,
    is_active: form.is_active,
  };
  if (weight !== undefined) data.weight = weight;
  if (form.scope_type === 'day' || form.scope_type === 'event') data.scope_id = form.scope_id;
  if (form.reason.trim()) data.reason = form.reason.trim();
  return { ok: true, data };
}

/** 一覧をハード/ソフトに分ける(backendはハードを先に返すが、画面側でも明示的に分ける)。 */
export function splitByHardness(items: PlanConstraint[]): { hard: PlanConstraint[]; soft: PlanConstraint[] } {
  return {
    hard: items.filter((c) => c.hardness === 'hard'),
    soft: items.filter((c) => c.hardness === 'soft'),
  };
}
