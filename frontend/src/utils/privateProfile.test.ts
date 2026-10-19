import { describe, it, expect } from 'vitest';
import { describeItem, draftToItem, emptyDraft } from './privateProfile';

describe('非公開の条件の入力 (Gate C1 FR-023)', () => {
  it('種類ごとに値を検査する', () => {
    expect(draftToItem({ ...emptyDraft('earliest_start'), label: '朝', value: '11:00' }))
      .toEqual({ kind: 'earliest_start', label: '朝', hardness: 'hard', value: '11:00', unit: null });
    expect(draftToItem({ ...emptyDraft('earliest_start'), label: '', value: '11:00' })).toMatch(/名前/);
    expect(draftToItem({ ...emptyDraft('earliest_start'), label: '朝', value: '' })).toMatch(/時刻/);
    expect(draftToItem({ ...emptyDraft('trip_budget_max'), label: '予算', value: '80000', hardness: 'soft' }))
      .toEqual({ kind: 'trip_budget_max', label: '予算', hardness: 'soft', value: 80000, unit: 'JPY' });
    expect(draftToItem({ ...emptyDraft('daily_travel_max'), label: '移動', value: '-1' })).toMatch(/0以上/);
    expect(draftToItem({ ...emptyDraft('daily_travel_max'), label: '移動', value: '90', unit: 'JPY' })).toMatch(/単位/);
    expect(draftToItem({ ...emptyDraft('avoid_text'), label: '苦手', value: ' 生魚 ' })).toMatchObject({ value: '生魚' });
    expect(draftToItem({ ...emptyDraft('avoid_text'), label: '苦手', value: '  ' })).toMatch(/1〜200/);
  });

  it('本人に見せる一覧の文面', () => {
    expect(describeItem({ id: '1', kind: 'earliest_start', label: '朝', hardness: 'hard', value: '11:00', unit: null }))
      .toBe('開始が早すぎない: 11:00より後に始める(必ず守る)');
    expect(describeItem({ id: '2', kind: 'daily_travel_max', label: '移動', hardness: 'soft', value: 90, unit: 'minutes' }))
      .toBe('1日の移動の上限: 90分まで(できれば)');
    expect(describeItem({ id: '3', kind: 'avoid_transport', label: '飛行機', hardness: 'hard', value: '飛行機', unit: null }))
      .toBe('避けたい移動手段: 「飛行機」(必ず守る)');
  });
});
