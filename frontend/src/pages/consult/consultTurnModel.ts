/**
 * [Gate F07] 会話の1ターンの変更案を、確認の画面(ReviewState)へ重ねる。
 *
 * - AI へ送るのは最新の発言と、ここで作る今の条件の状態(値・確認の状態・ID)だけ(以前の発言の全文を送り直さない)
 * - 確かめた行への変更は「変更案」(項目は既存の proposals、予算・その他の希望・方面の取り消しは turnPending)。
 *   採用するまで変えない。確かめていない行は新しい値にする(AI の読み取り · 未確認)
 * - 予算は複数(主な予算の行 + 追加の予算)。人数を変えても予算の額・何人分かを計算し直さない
 * - 食い違い・問いは「確かめてほしいこと」に出す(片方に決めない)
 * - 変更案の採用・却下・元に戻すは外へ送らない(費用・回数を戻さない)
 */
import type { TurnBudget, TurnChange, TurnField, TurnResult, TurnState } from '@/services/api/consultAi';
import type { BudgetKind, BudgetPeriod, BudgetTarget } from '@/services/api/types/tripIntent';
import { BUDGET_KIND_LABEL, BUDGET_PERIOD_LABEL, BUDGET_TARGET_LABEL, PREFERENCE_LABEL } from './consultModel';
import type { ReviewKey, ReviewState, ReviewValues } from './consultModel';

/** 追加の予算(主な予算の行の他)。何人分か(people)を持つ */
export interface BudgetItem extends TurnBudget {
  id: string; confirmed: boolean; evidence?: string | null;
}

export const MAIN_BUDGET_ID = 'b-main';

const FIELD_ROW: Record<TurnField, ReviewKey> = {
  origin: 'origin', party_size: 'party_size', nights: 'nights', transport: 'transport', highway: 'transport',
  one_way_hours: 'one_way', room: 'room', dates: 'dates',
};
export const FIELD_LABEL: Record<TurnField, string> = {
  origin: '出発地', party_size: '人数', nights: '泊数', transport: '移動', highway: '高速道路', one_way_hours: '片道の時間',
  room: '部屋', dates: '日程',
};

function fieldValue(v: ReviewValues, f: TurnField): unknown {
  switch (f) {
    case 'origin': return v.origin.trim() || null;
    case 'party_size': return v.party_size;
    case 'nights': return v.nights;
    case 'transport': return v.transport === 'undecided' ? null : v.transport;
    case 'highway': return v.transport === 'car' ? v.highway : null;
    case 'one_way_hours': return v.one_way_hours;
    case 'room': return v.room === 'undecided' ? null : v.room;
    case 'dates': return v.travel_window.trim() || null;
    default: return null;
  }
}

function setField(v: ReviewValues, f: TurnField, value: unknown): ReviewValues {
  const out = { ...v };
  switch (f) {
    case 'origin': out.origin = typeof value === 'string' ? value : ''; break;
    case 'party_size': out.party_size = typeof value === 'number' ? value : null; break;
    case 'nights': out.nights = typeof value === 'number' ? value : null; break;
    case 'transport': out.transport = value === 'car' || value === 'public' ? value : 'undecided'; break;
    case 'highway': out.highway = Boolean(value); break;
    case 'one_way_hours': out.one_way_hours = typeof value === 'number' ? value : null; break;
    case 'room': out.room = value === 'same_room' || value === 'multiple_rooms' ? value : 'undecided'; break;
    case 'dates':
      out.travel_window = typeof value === 'string' ? value : '';
      out.date_status = typeof value === 'string' && value ? (out.date_status === 'fixed' ? 'fixed' : 'window') : 'undecided';
      break;
    default: break;
  }
  return out;
}

function mainBudget(r: ReviewState): BudgetItem | null {
  const v = r.values;
  if (v.budget_min_man === null && v.budget_max_man === null) return null;
  return {
    id: MAIN_BUDGET_ID, confirmed: r.confirmed.budget,
    min_yen: v.budget_min_man !== null ? Math.round(v.budget_min_man * 10000) : null,
    max_yen: v.budget_max_man !== null ? Math.round(v.budget_max_man * 10000) : null,
    unit: v.budget_scope, people: r.mainBudgetPeople ?? null, target: v.budget_target, period: v.budget_period,
    kind: v.budget_kind,
  };
}

function setMainBudget(r: ReviewState, b: TurnBudget): ReviewState {
  const man = (y: number | null) => (y === null ? null : y / 10000);
  const lo = b.min_yen ?? b.max_yen;
  const hi = b.max_yen ?? b.min_yen;
  return {
    ...r, mainBudgetPeople: b.people,
    values: { ...r.values, budget_min_man: man(lo), budget_max_man: man(hi), budget_scope: b.unit,
      budget_target: b.target as BudgetTarget, budget_period: b.period as BudgetPeriod, budget_kind: b.kind as BudgetKind },
  };
}

/** AI へ送る今の条件(値・確認の状態・ID)。根拠の文・過去の発言は入れない */
export function turnStateOf(r: ReviewState, areaNames: string[]): TurnState {
  const fields: TurnState['fields'] = {};
  for (const f of Object.keys(FIELD_ROW) as TurnField[]) {
    const value = fieldValue(r.values, f);
    if (value !== null) fields[f] = { value, confirmed: Boolean(r.confirmed[FIELD_ROW[f]]) };
  }
  const main = mainBudget(r);
  const budgets = [...(main ? [main] : []), ...(r.extraBudgets ?? [])].map((b) => ({
    id: b.id, confirmed: b.confirmed, min_yen: b.min_yen, max_yen: b.max_yen, unit: b.unit, people: b.people,
    target: b.target, period: b.period, kind: b.kind }));
  return {
    revision: r.revision ?? 0, fields, budgets,
    notes: (r.notes ?? []).map((text, i) => ({ id: `n${i + 1}`, text, confirmed: true })),
    areas: areaNames.map((name) => ({ name, status: name === r.decidedArea ? 'decided' as const : 'candidate' as const })),
    preferences: r.values.preferences,
  };
}

/** 1つの変更を適用する(採用した変更案・確かめていない行への変更)。確かめた行を採用した時は確かめたまま */
function applyOne(r: ReviewState, areaNames: string[], c: TurnChange, accepted: boolean): { review: ReviewState; areaNames: string[] } {
  let review = { ...r, values: { ...r.values }, sources: { ...r.sources }, confirmed: { ...r.confirmed },
    evidence: { ...r.evidence } };
  let areas = [...areaNames];
  const mark = (key: ReviewKey) => {
    review.sources[key] = 'ai';
    review.confirmed[key] = accepted;
    review.evidence[key] = c.evidence;
  };
  if ((c.op === 'set' || c.op === 'clear') && c.field) {
    review.values = setField(review.values, c.field, c.op === 'clear' ? null : c.after);
    mark(FIELD_ROW[c.field]);
  } else if (c.op === 'add_preference' && c.preference && c.preference in PREFERENCE_LABEL) {
    review.values.preferences = Array.from(new Set([...review.values.preferences, c.preference]));
  } else if (c.op === 'remove_preference' && c.preference) {
    review.values.preferences = review.values.preferences.filter((p) => p !== c.preference);
  } else if (c.op === 'add_note' && typeof c.after === 'string') {
    review.notes = Array.from(new Set([...(review.notes ?? []), c.after])).slice(0, 10);
  } else if (c.op === 'remove_note' && c.target_id) {
    const i = Number(c.target_id.replace(/^n/, '')) - 1;
    review.notes = (review.notes ?? []).filter((_n, j) => j !== i);
  } else if ((c.op === 'add_budget' || c.op === 'update_budget') && c.after && typeof c.after === 'object' && c.target_id) {
    const b = c.after as TurnBudget;
    if (c.target_id === MAIN_BUDGET_ID) {
      review = setMainBudget(review, b);
      mark('budget');
    } else {
      const list = [...(review.extraBudgets ?? [])];
      const i = list.findIndex((x) => x.id === c.target_id);
      const item: BudgetItem = { ...b, id: c.target_id, confirmed: accepted, evidence: c.evidence };
      if (i >= 0) list[i] = item; else list.push(item);
      review.extraBudgets = list.slice(0, 6);
    }
  } else if (c.op === 'remove_budget' && c.target_id) {
    if (c.target_id === MAIN_BUDGET_ID) {
      review.values = { ...review.values, budget_min_man: null, budget_max_man: null, budget_scope: 'undecided',
        budget_target: 'undecided', budget_period: 'undecided', budget_kind: 'undecided' };
      review.mainBudgetPeople = null;
      mark('budget');
    } else {
      review.extraBudgets = (review.extraBudgets ?? []).filter((x) => x.id !== c.target_id);
    }
  } else if (c.op === 'area_candidate' && c.area) {
    areas = Array.from(new Set([...areas, c.area])).slice(0, 10);
  } else if (c.op === 'area_decide' && c.area) {
    areas = Array.from(new Set([...areas, c.area])).slice(0, 10);
    review.decidedArea = c.area;
  } else if (c.op === 'area_remove' && c.area) {
    areas = areas.filter((a) => a !== c.area);
    if (review.decidedArea === c.area) review.decidedArea = null;
  }
  return { review, areaNames: areas };
}

const show = (v: unknown): string => (v === null || v === undefined || v === '' ? '未定' : typeof v === 'boolean'
  ? (v ? 'あり' : 'なし') : String(v));

/** 変更案の短い説明(画面の一覧) */
export function changeLabel(c: TurnChange): string {
  if (c.field) return `${FIELD_LABEL[c.field]}: ${show(c.before)} → ${c.op === 'clear' ? '未定(取り消し)' : show(c.after)}`;
  if (c.op === 'remove_note') return `その他の希望を外す: ${show(c.before)}`;
  if (c.op === 'remove_budget') return '予算を外す';
  if (c.op === 'update_budget' || c.op === 'add_budget') return `予算: ${budgetLabel(c.after as TurnBudget)}`;
  if (c.op === 'remove_preference') return `過ごし方を外す: ${c.label ?? c.preference}`;
  if (c.op === 'area_remove') return `方面を外す: ${c.area}`;
  return c.op;
}

export function budgetLabel(b: TurnBudget | null | undefined): string {
  if (!b) return '未定';
  const man = (y: number) => `${y / 10000}万円`;
  const amount = b.min_yen !== null && b.max_yen !== null && b.min_yen !== b.max_yen
    ? `${man(b.min_yen)}〜${man(b.max_yen)}` : b.max_yen !== null ? man(b.max_yen) : b.min_yen !== null ? man(b.min_yen) : '額は未定';
  const unit = b.unit === 'total' ? '全員の合計' : b.unit === 'per_person' ? '1人あたり' : '誰の分か未定';
  return [amount, BUDGET_TARGET_LABEL[b.target as BudgetTarget] ?? b.target, unit,
    b.people ? `${b.people}人分` : null, BUDGET_PERIOD_LABEL[b.period as BudgetPeriod] ?? b.period,
    BUDGET_KIND_LABEL[b.kind as BudgetKind] ?? b.kind].filter(Boolean).join(' · ');
}

/**
 * 1ターンの結果を重ねる。確かめた行への変更は変更案に、確かめていない行は新しい値に。食い違い・問いは別に返す。
 */
export function applyTurn(r: ReviewState, areaNames: string[], result: TurnResult): {
  review: ReviewState; areaNames: string[]; contradictions: string[]; questions: string[];
} {
  let review: ReviewState = { ...r, proposals: { ...(r.proposals ?? {}) }, turnPending: [...(r.turnPending ?? [])],
    revision: result.revision };
  let areas = [...areaNames];
  for (const c of result.changes) {
    if (c.needs_confirmation) {
      if (c.field && (c.op === 'set' || c.op === 'clear')) {
        // 確かめた項目への変更は、既存の「変更案」(採用するまで変えない)
        const key = FIELD_ROW[c.field];
        const next = setField(review.values, c.field, c.op === 'clear' ? null : c.after);
        const fields = (Object.keys(FIELD_ROW) as TurnField[]).filter((f) => FIELD_ROW[f] === key);
        const values: Partial<ReviewValues> = {};
        for (const f of fields) Object.assign(values, pick(next, f));
        review.proposals![key] = { from: show(c.before), to: c.op === 'clear' ? '未定(取り消し)' : show(c.after), values };
      } else {
        review.turnPending = [...review.turnPending!.filter((p) => p.id !== c.id), c];
      }
      continue;
    }
    ({ review, areaNames: areas } = applyOne(review, areas, c, false));
  }
  return {
    review, areaNames: areas,
    contradictions: result.conflicts.map((x) => x.question),
    questions: result.questions,
  };
}

function pick(v: ReviewValues, f: TurnField): Partial<ReviewValues> {
  switch (f) {
    case 'origin': return { origin: v.origin };
    case 'party_size': return { party_size: v.party_size };
    case 'nights': return { nights: v.nights };
    case 'transport': return { transport: v.transport };
    case 'highway': return { highway: v.highway };
    case 'one_way_hours': return { one_way_hours: v.one_way_hours };
    case 'room': return { room: v.room };
    case 'dates': return { travel_window: v.travel_window, date_status: v.date_status };
    default: return {};
  }
}

/** turnPending の変更案を採用する・しない(外へ送らない) */
export function decideTurnChange(r: ReviewState, areaNames: string[], id: string, accept: boolean): {
  review: ReviewState; areaNames: string[];
} {
  const c = (r.turnPending ?? []).find((p) => p.id === id);
  const rest = (r.turnPending ?? []).filter((p) => p.id !== id);
  if (!c) return { review: r, areaNames };
  if (!accept) return { review: { ...r, turnPending: rest }, areaNames };
  const out = applyOne({ ...r, turnPending: rest }, areaNames, c, true);
  return out;
}

/** 下書きへ渡す予算(確かめたものだけ。主な予算の行 + 追加の予算) */
export function confirmedBudgets(r: ReviewState): TurnBudget[] {
  const main = mainBudget(r);
  return [...(main && main.confirmed ? [main] : []), ...(r.extraBudgets ?? []).filter((b) => b.confirmed)]
    .map(({ min_yen, max_yen, unit, people, target, period, kind }) => ({ min_yen, max_yen, unit, people, target, period, kind }));
}
