/**
 * [Gate F07] 1ターンの変更案の重ね合わせ: 確かめた行は変更案、確かめていない行は新しい値、複数の予算、方面の候補と決定、
 * 食い違いは決めない、採用・却下は外へ送らない、送る状態に過去の発言・根拠の文を入れない。
 */
import { describe, expect, it } from 'vitest';
import type { TurnChange, TurnResult } from '@/services/api/consultAi';
import { initReview, intentOf, type ReviewState } from './consultModel';
import { applyTurn, changeLabel, decideTurnChange, MAIN_BUDGET_ID, turnStateOf } from './consultTurnModel';
import type { IntentExtraction } from '@/services/api/types/tripIntent';

const item = (key: string, over: Record<string, unknown>) => ({
  key, label: key, value: null, display: '', source: 'unspecified', strength: 'undecided', evidence: null, question: null,
  needs_answer: false, note: null, sensitive: false, ...over,
});
function base(): ReviewState {
  const ex = { extractor: 'rules', ai_connected: false, nights: 1, areas: [], items: [
    item('origin', { value: '枚方', source: 'user_input' }), item('party_size', { value: 4, source: 'user_input' }),
    item('nights', { value: 1, source: 'text' }), item('transport', {}), item('one_way', {}), item('room', {}),
    item('budget', { value: { min: 60000, max: 80000, scope: 'total', target: 'lodging', period: 'undecided', kind: 'guide' },
      source: 'user_input' }),
    item('dates', { value: { status: 'undecided' } }), item('preferences', { value: ['quiet'], source: 'user_input' }),
  ] } as unknown as IntentExtraction;
  return { ...initReview(ex), notes: ['市場に寄りたい'] };
}
const result = (changes: TurnChange[], over: Partial<TurnResult> = {}): TurnResult => ({
  changes, conflicts: [], questions: [], dropped: 0, revision: 1, base_revision: 0,
  usage: { currency: 'JPY', plan_cap: '50', plan_used: '1', plan_reserved: '0', plan_remaining: '49', class: 'journey' },
  saved: false, stub: false, notice: '', ...over,
});

describe('[F07] 会話の1ターン', () => {
  it('送る状態は値・確認の状態・ID だけ(根拠の文・相談の文章は入れない)。主な予算は b-main', () => {
    const st = turnStateOf(base(), ['伊勢']);
    expect(st.fields.party_size).toEqual({ value: 4, confirmed: true });
    expect(st.fields.nights).toEqual({ value: 1, confirmed: false });
    expect(st.budgets[0]).toMatchObject({ id: MAIN_BUDGET_ID, min_yen: 60000, max_yen: 80000, target: 'lodging', confirmed: true });
    expect(st.notes).toEqual([{ id: 'n1', text: '市場に寄りたい', confirmed: true }]);
    expect(st.areas).toEqual([{ name: '伊勢', status: 'candidate' }]);
    expect(JSON.stringify(st)).not.toContain('evidence');
  });

  it('確かめた行は変更案(採用するまで変えない)、確かめていない行は新しい値。食い違いは決めずに問いにする', () => {
    const out = applyTurn(base(), [], result([
      { id: 'c1', op: 'set', field: 'party_size', before: 4, after: 3, evidence: '3人に変更', needs_confirmation: true },
      { id: 'c2', op: 'set', field: 'nights', before: 1, after: 2, evidence: '2泊', needs_confirmation: false },
    ], { conflicts: [{ about: 'nights', question: '日帰りと1泊が食い違っています。どちらですか' }] }));
    expect(out.review.values.party_size).toBe(4);
    expect(out.review.proposals?.party_size).toMatchObject({ from: '4', to: '3', values: { party_size: 3 } });
    expect(out.review.values.nights).toBe(2);
    expect(out.review.confirmed.nights).toBe(false);
    expect(out.review.evidence.nights).toBe('2泊');
    expect(out.contradictions).toEqual(['日帰りと1泊が食い違っています。どちらですか']);
    expect(out.review.revision).toBe(1);
  });

  it('複数の予算: 主な予算の行の上限への訂正と、旅行全体の予算の追加。人数を変えても予算は計算し直さない', () => {
    const out = applyTurn(base(), [], result([
      { id: 'c1', op: 'update_budget', target_id: MAIN_BUDGET_ID, evidence: '8万円は宿だけの上限', needs_confirmation: true,
        before: {}, after: { min_yen: 60000, max_yen: 80000, unit: 'total', people: 4, target: 'lodging', period: 'undecided', kind: 'cap' } },
      { id: 'c2', op: 'add_budget', target_id: 'b-x1', evidence: '旅行全体は12万円まで', needs_confirmation: false,
        after: { min_yen: null, max_yen: 120000, unit: 'total', people: null, target: 'trip_total', period: 'whole_trip', kind: 'cap' } },
    ]));
    expect(out.review.turnPending?.map((c) => c.id)).toEqual(['c1']);
    expect(out.review.values.budget_kind).toBe('guide'); // 採用するまで変えない
    expect(out.review.extraBudgets?.[0]).toMatchObject({ id: 'b-x1', max_yen: 120000, target: 'trip_total', confirmed: false });
    const accepted = decideTurnChange(out.review, [], 'c1', true);
    expect(accepted.review.values.budget_kind).toBe('cap');
    expect(accepted.review.mainBudgetPeople).toBe(4);
    expect(accepted.review.turnPending).toEqual([]);
    // 確かめた予算だけを下書きへ(追加の予算は確かめてから)
    expect(intentOf(accepted.review).budgets).toHaveLength(1);
    const both = { ...accepted.review, extraBudgets: accepted.review.extraBudgets!.map((b) => ({ ...b, confirmed: true })) };
    expect(intentOf(both).budgets?.map((b) => b.target)).toEqual(['lodging', 'trip_total']);
  });

  it('その他の希望の削除・方面の候補と決定。却下した変更案は何も変えない', () => {
    const out = applyTurn(base(), ['滋賀'], result([
      { id: 'c1', op: 'remove_note', target_id: 'n1', before: '市場に寄りたい', evidence: '市場はもう行かなくていい', needs_confirmation: true },
      { id: 'c2', op: 'area_candidate', area: '伊勢', evidence: '伊勢か滋賀', needs_confirmation: false },
      { id: 'c3', op: 'area_decide', area: '伊勢', evidence: '伊勢に決める', needs_confirmation: false },
    ]));
    expect(out.areaNames).toEqual(['滋賀', '伊勢']);
    expect(out.review.decidedArea).toBe('伊勢');
    expect(out.review.notes).toEqual(['市場に寄りたい']);
    expect(changeLabel(out.review.turnPending![0]!)).toBe('その他の希望を外す: 市場に寄りたい');
    const rejected = decideTurnChange(out.review, out.areaNames, 'c1', false);
    expect(rejected.review.notes).toEqual(['市場に寄りたい']);
    const removed = decideTurnChange(out.review, out.areaNames, 'c1', true);
    expect(removed.review.notes).toEqual([]);
    expect(turnStateOf(removed.review, removed.areaNames).areas).toEqual([
      { name: '滋賀', status: 'candidate' }, { name: '伊勢', status: 'decided' }]);
  });
});
