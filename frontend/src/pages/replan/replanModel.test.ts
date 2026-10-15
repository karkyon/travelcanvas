/**
 * [Gate P10] 外部状況(アラート)・再計画の表示・入力検証(replanModel)。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Replan } from '@/services/api';
import {
  alertFormToPayload, confirmText, describeChange, emptyAlertForm, formatCost, formatMinutes, formatObserved,
  replanErrorInfo, sameOutcome,
} from './replanModel';

const NOW = Date.parse('2026-11-01T03:00:00Z');

describe('alertFormToPayload (Gate P10)', () => {
  it('遅延は予定と15〜720分が必要。情報源・メモは前後の空白を除く', () => {
    const f = { ...emptyAlertForm(), kind: 'delay' as const };
    expect(alertFormToPayload(f, NOW)).toEqual({ ok: false, error: '影響を受ける予定を選んでください' });
    expect(alertFormToPayload({ ...f, event_id: 'e1', delay_minutes: '10' }, NOW).ok).toBe(false);
    expect(alertFormToPayload({ ...f, event_id: 'e1', delay_minutes: '90', source_label: ' 駅の掲示 ', note: ' ' }, NOW))
      .toEqual({ ok: true, data: { kind: 'delay', source: 'user_report', confidence: 'reported', event_id: 'e1',
        delay_minutes: 90, source_label: '駅の掲示' } });
  });

  it('雨天は日が必要(遅れは送らない)。休業は予定だけ。未来の取得時刻は不可', () => {
    const w = { ...emptyAlertForm(), kind: 'weather' as const };
    expect(alertFormToPayload(w, NOW)).toEqual({ ok: false, error: '影響を受ける日を選んでください' });
    expect(alertFormToPayload({ ...w, day_id: 'd1' }, NOW)).toEqual({
      ok: true, data: { kind: 'weather', source: 'user_report', confidence: 'reported', day_id: 'd1' } });
    const c = alertFormToPayload({ ...emptyAlertForm(), kind: 'closure', event_id: 'e2' }, NOW);
    expect(c.ok && c.data).toEqual({ kind: 'closure', source: 'user_report', confidence: 'reported', event_id: 'e2' });
    const future = alertFormToPayload({ ...w, day_id: 'd1', observed_at: '2026-11-01T05:00:00Z' }, NOW);
    expect(future).toEqual({ ok: false, error: '取得時刻に未来の時刻は指定できません' });
    const past = alertFormToPayload({ ...w, day_id: 'd1', observed_at: '2026-11-01T02:00:00Z' }, NOW);
    expect(past.ok && past.data.observed_at).toBe('2026-11-01T02:00:00.000Z');
  });
});

describe('整形 (Gate P10)', () => {
  it('取得時刻・時間差・変更・費用', () => {
    expect(formatObserved('2026-11-01T02:30:00Z', NOW)).toMatch(/取得\(30分前\)$/);
    expect(formatObserved('2026-10-31T23:00:00Z', NOW)).toMatch(/\(4時間前\)$/);
    expect(formatObserved(null, NOW)).toBe('取得時刻不明');
    expect(formatMinutes(120)).toBe('+2時間');
    expect(formatMinutes(-90)).toBe('−1時間30分');
    expect(formatMinutes(0)).toBe('変わらない');
    expect(formatMinutes(null)).toBe('—');
    expect(describeChange({ event_id: 'e', title: '電車', before_time: '09:00', after_time: '11:00',
      before_date: '2026-11-01', after_date: '2026-11-01' })).toBe('電車: 09:00 → 11:00');
    expect(describeChange({ event_id: 'e', title: '庭園', before_time: '14:00', after_time: '14:00',
      before_date: '2026-11-01', after_date: '2026-11-02' })).toBe('庭園: 11/1 14:00 → 11/2 14:00');
    expect(formatCost(null)).toBe('—');
    expect(formatCost({ currency: 'JPY', lost_paid_amount: '0.00', lost_paid_count: 0, unconverted_count: 0 }))
      .toBe('外す予定に支払い済みの費用はありません');
    expect(formatCost({ currency: 'JPY', lost_paid_amount: '12000.00', lost_paid_count: 2, unconverted_count: 1 }))
      .toBe('外す予定に支払い済みの費用 12,000 JPY(2件)(ほかに換算できない費用1件)');
  });

  it('同じ結果の案・承認の確認文・409の案内', () => {
    const created = fx.replan_created as Replan;
    const closure = fx.replan_closure as Replan;
    expect(sameOutcome(created.candidates[0]!, created.candidates[1]!)).toBe(true);
    expect(sameOutcome(closure.candidates[0]!, closure.candidates[1]!)).toBe(false);
    const text = confirmText(created.candidates[0]!);
    expect(text).toContain('案A「後ろの予定をずらす」で旅程を変更します。変わる予定1件・外す予定1件。');
    expect(text).toContain('さんへ変更を通知します。');
    const stale = replanErrorInfo({ response: { data: fx.replan_stale_error } });
    expect(stale.code).toBe('replan_stale');
    const conflict = replanErrorInfo({ response: { data: { detail: {
      code: 'replan_conflict', message: '食い違い', conflicts: [{ op: 'remove', title: '清水寺', reason: 'has_relations' }] } } } });
    expect(conflict.items).toEqual(['「清水寺」: 予約・移動・文書と紐付いたため外せません']);
    expect(replanErrorInfo(new Error('x'))).toEqual({ code: null, message: '処理に失敗しました', items: [] });
  });
});
