/**
 * [Gate L2] 制約画面の表示整形・フォーム変換(constraintModel)の単体テスト。
 * 値の規則はbackend(app/api/v1/constraints.py _validate_value)と一致させる。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { PlanConstraint } from '@/services/api';
import {
  applyTypePreset, describeCondition, describeScope, emptyForm, formFromConstraint, formToPayload, operatorKind,
  splitByHardness, TYPE_OPTIONS, type ConstraintForm,
} from './constraintModel';

const shared = fx.constraint_shared as PlanConstraint;
const between = fx.constraint_soft_between as PlanConstraint;
const eventScoped = fx.constraint_event_scope as PlanConstraint;
const privateMine = fx.constraint_private_mine as PlanConstraint;
const masked = fx.constraint_masked as PlanConstraint;

function form(overrides: Partial<ConstraintForm>): ConstraintForm {
  return { ...emptyForm(), title: '題名', ...overrides };
}

describe('表示整形 (Gate L2)', () => {
  it('条件を読める一文にする', () => {
    expect(describeCondition(shared)).toBe('上限 50000 円');
    expect(describeCondition(between)).toBe('11:30〜13:00 の間');
    expect(describeCondition(eventScoped)).toBe('16:00 より前');
    expect(describeCondition(privateMine)).toBe('「えび」を避ける');
    expect(describeCondition(masked)).toBe('');
  });

  it('適用範囲を表示し、削除された対象を明示する', () => {
    expect(describeScope(shared)).toBe('プラン全体');
    expect(describeScope(between)).toBe('日: 2026-11-01');
    expect(describeScope(eventScoped)).toBe('イベント: 清水寺');
    expect(describeScope(privateMine)).toBe('個人: owner_fixture_l2');
    expect(describeScope({ ...eventScoped, scope_label: null, scope_missing: true })).toBe('イベント: (対象は削除されています)');
  });

  it('ハード/ソフトで分ける(秘匿で隠れた制約も区分は分かる)', () => {
    const { hard, soft } = splitByHardness([shared, between, masked]);
    expect(hard.map((c) => c.id)).toEqual([shared.id, masked.id]);
    expect(soft.map((c) => c.id)).toEqual([between.id]);
  });
});

describe('フォーム変換 (Gate L2)', () => {
  it('全ての種類に既定の強さと条件がある', () => {
    for (const t of TYPE_OPTIONS) {
      const f = applyTypePreset(emptyForm(), t.value);
      expect(f.hardness).toBe(t.hardness);
      expect(f.operator).toBe(t.operator);
    }
  });

  it('種類を変えて条件の型(時刻/数値/文字)が変わると値を消す', () => {
    const f = applyTypePreset({ ...emptyForm('budget_limit'), value: '50000', unit: 'JPY' }, 'last_transport');
    expect(f).toMatchObject({ operator: 'before', value: '', unit: '' });
    const g = applyTypePreset({ ...emptyForm('budget_limit'), value: '50000', unit: 'JPY' }, 'fatigue');
    expect(g).toMatchObject({ operator: 'max', value: '50000', unit: 'JPY', hardness: 'soft' });
  });

  it('時刻・数値・文字の値を検証してAPIの形にする', () => {
    expect(formToPayload(form({ operator: 'before', value: '21:30', hardness: 'hard' }))).toEqual({
      ok: true,
      data: {
        title: '題名', constraint_type: 'budget_limit', hardness: 'hard', operator: 'before',
        value: { value: '21:30' }, scope_type: 'plan', privacy_level: 'shared', is_active: true,
      },
    });
    expect(formToPayload(form({ operator: 'between', value: '22:00', value_to: '02:00' }))).toMatchObject({
      ok: true, data: { value: { value: '22:00', value_to: '02:00' } },
    });
    expect(formToPayload(form({ operator: 'max', value: '90', unit: 'minutes' }))).toMatchObject({
      ok: true, data: { value: { value: 90, unit: 'minutes' } },
    });
    expect(formToPayload(form({ operator: 'avoid', value: '  タクシー ' }))).toMatchObject({
      ok: true, data: { value: { value: 'タクシー' } },
    });
  });

  it('不正な入力は送らずに理由を返す', () => {
    const cases: Array<[Partial<ConstraintForm>, RegExp]> = [
      [{ title: '  ' }, /題名/],
      [{ operator: 'before', value: '25:00' }, /HH:MM/],
      [{ operator: 'between', value: '10:00', value_to: '' }, /終了時刻/],
      [{ operator: 'between', value: '10:00', value_to: '10:00' }, /同じ時刻/],
      [{ operator: 'max', value: '-1', unit: 'JPY' }, /0以上/],
      [{ operator: 'max', value: '', unit: 'JPY' }, /0以上/],
      [{ operator: 'max', value: '10', unit: '' }, /単位/],
      [{ operator: 'prefer', value: '' }, /1〜200/],
      [{ hardness: 'soft', weight: '0' }, /重み/],
      [{ hardness: 'soft', weight: '1.5' }, /重み/],
      [{ scope_type: 'day', scope_id: '' }, /日を選択/],
      [{ scope_type: 'event', scope_id: '' }, /イベントを選択/],
    ];
    for (const [overrides, pattern] of cases) {
      const result = formToPayload(form({ value: '1000', ...overrides }));
      expect(result.ok, JSON.stringify(overrides)).toBe(false);
      if (!result.ok) expect(result.error).toMatch(pattern);
    }
  });

  it('ソフトは重みを付け、ハードは重みを送らない。日・イベントは対象IDを送り、個人は本人扱いで省略する', () => {
    const soft = formToPayload(form({ hardness: 'soft', weight: '70', value: '1' }));
    expect(soft.ok && soft.data.weight).toBe(70);
    const hard = formToPayload(form({ hardness: 'hard', weight: '70', value: '1' }));
    expect(hard.ok && 'weight' in hard.data).toBe(false);
    const day = formToPayload(form({ scope_type: 'day', scope_id: 'd1', value: '1' }));
    expect(day.ok && day.data.scope_id).toBe('d1');
    const member = formToPayload(form({ scope_type: 'member', scope_id: 'x', value: '1' }));
    expect(member.ok && 'scope_id' in member.data).toBe(false);
    const withReason = formToPayload(form({ reason: '  理由 ', privacy_level: 'private', value: '1' }));
    expect(withReason.ok && withReason.data).toMatchObject({ reason: '理由', privacy_level: 'private' });
  });

  it('既存の制約からフォームを作り、そのまま送り直すと同じ内容になる', () => {
    for (const c of [shared, between, eventScoped, privateMine]) {
      const result = formToPayload(formFromConstraint(c));
      expect(result.ok, c.title ?? '').toBe(true);
      if (!result.ok) continue;
      expect(result.data).toMatchObject({
        title: c.title, constraint_type: c.constraint_type, hardness: c.hardness, operator: c.operator,
        privacy_level: c.privacy_level, scope_type: c.scope_type,
      });
      expect(result.data.value.value).toEqual(c.value?.value);
    }
    expect(operatorKind('between')).toBe('time');
  });
});
