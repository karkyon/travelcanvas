/**
 * [Gate P7] branchModel(What-ifの入力検証・表示)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { BranchDetail } from '@/services/api';
import {
  contentToPayload, createFormToPayload, describeConflict, describeOp, emptyCreateForm, groupByDay, newItem,
} from './branchModel';

describe('branchModel (Gate P7)', () => {
  it('作成フォーム: 想定ごとの入力を検証する', () => {
    const f = { ...emptyCreateForm(), title: ' 遅延 ', scenario_type: 'delay' as const };
    expect(createFormToPayload({ ...f, title: '' })).toEqual({ ok: false, error: '題名を入力してください' });
    expect(createFormToPayload(f)).toEqual({ ok: false, error: '遅延を想定する日を選んでください' });
    expect(createFormToPayload({ ...f, day_id: 'd1', minutes: '5' }).ok).toBe(false);
    expect(createFormToPayload({ ...f, day_id: 'd1', minutes: '120', after: '11:00', note: ' 朝 ' })).toEqual({
      ok: true, data: { title: '遅延', scenario_type: 'delay', assumptions: { note: '朝', day_id: 'd1', minutes: 120, after: '11:00' } },
    });
    expect(createFormToPayload({ ...f, scenario_type: 'fatigue', max_events_per_day: '11' }).ok).toBe(false);
    expect(createFormToPayload({ ...f, scenario_type: 'budget', budget_cut_percent: '30' })).toMatchObject({
      ok: true, data: { assumptions: { budget_cut_percent: 30 } } });
    expect(createFormToPayload({ ...f, scenario_type: 'rain' })).toEqual({
      ok: true, data: { title: '遅延', scenario_type: 'rain', assumptions: {} } });
  });

  it('分岐案の送信内容: 時刻と題名を検証し、追加した予定は外す扱いにしない', () => {
    const d = fx.branch_content_saved as BranchDetail;
    const ok = contentToPayload(d.content);
    expect(ok.ok && ok.data.length).toBe(d.content.length);
    const added = { ...newItem(d.days[0]!.id, 1), title: '新しい予定', removed: true };
    const r = contentToPayload([added]);
    expect(r.ok && r.data[0]).toMatchObject({ source_event_id: null, removed: false, title: '新しい予定' });
    expect(contentToPayload([{ ...added, title: ' ' }]).ok).toBe(false);
    expect(contentToPayload([{ ...added, local_start_time: '9:00' }])).toEqual({ ok: false, error: '「新しい予定」の時刻はHH:MMで入力してください' });
  });

  it('差分と採用できない理由を文にする', () => {
    const d = fx.branch_conflicted as BranchDetail;
    expect(describeConflict(d.conflicts[0]!)).toBe('「清水寺」: 分岐した後に本案でも変更されています(開始時刻)');
    const labels = d.ops.map((o) => describeOp(o, () => '2026-11-01'));
    expect(labels).toContain('外す: 清水寺');
    expect(labels).toContain('追加: 水族館');
    expect(describeOp({ op: 'update', title: '昼食', fields: { local_start_time: '14:00', day_id: 'x' },
      before: { local_start_time: '12:00', day_id: 'y' } }, (id) => (id === 'x' ? '11/02' : '11/01')))
      .toBe('変更: 昼食(開始時刻 12:00 → 14:00、日付 11/01 → 11/02)');
  });

  it('日ごとに時刻順で並べる', () => {
    const d = fx.branch_content_saved as BranchDetail;
    const groups = groupByDay(d, d.content);
    expect(groups.map((g) => g.items.map((i) => i.local_start_time))[0]).toEqual(['09:00', '10:00', '12:00']);
  });
});
