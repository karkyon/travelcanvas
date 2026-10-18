/**
 * [Gate P11] planStore のオフライン編集: 通信できない時は画面の変更を残して端末に溜め、通信が戻ったら送る。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { TravelPlan } from '@/types';

const m = vi.hoisted(() => ({
  createEvent: vi.fn(), updateEvent: vi.fn(), deleteEvent: vi.fn(), syncOperations: vi.fn(),
  getPlan: vi.fn(), getPlanDetail: vi.fn(),
  toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }),
}));

vi.mock('@/services/api', () => ({
  api: {
    createEvent: m.createEvent, updateEvent: m.updateEvent, deleteEvent: m.deleteEvent, syncOperations: m.syncOperations,
    getPlan: m.getPlan, getPlanDetail: m.getPlanDetail, setGuestMode: vi.fn(), setMemberSession: vi.fn(), setAccessToken: vi.fn(),
    clearAccessToken: vi.fn(),
  },
  travelAPI: {},
}));
vi.mock('@/services/quickDraftApi', () => ({ createQuickDraft: vi.fn(), getStoredDeviceToken: vi.fn() }));
vi.mock('react-hot-toast', () => ({ toast: m.toast }));

import { OFFLINE_SAVED_MESSAGE, usePlanStore } from './planStore';
import { loadQueue } from '@/utils/syncQueue';

const NET = Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });

const plan = (): TravelPlan => ({
  id: 'p1', title: '旅', revision: 5,
  days: [{ id: 'd1', date: '2026-11-01', events: [
    { id: 'e1', title: '清水寺', category: 'sightseeing', start_time: '09:00' },
    { id: 'e2', title: '昼食', category: 'meal', start_time: '12:00' },
  ] }],
}) as unknown as TravelPlan;

beforeEach(() => {
  localStorage.clear();
  for (const fn of [m.createEvent, m.updateEvent, m.deleteEvent, m.syncOperations, m.getPlan, m.getPlanDetail,
    m.toast, m.toast.success, m.toast.error]) fn.mockReset();
  usePlanStore.setState({ currentPlan: plan(), pendingSyncCount: 0, syncConflictCount: 0, isSyncing: false });
});

describe('planStore オフライン編集 (Gate P11)', () => {
  it('通信できない変更・削除・追加は画面に残したまま端末に溜める', async () => {
    m.updateEvent.mockRejectedValue(NET);
    m.deleteEvent.mockRejectedValue(NET);
    m.createEvent.mockRejectedValue(NET);
    await usePlanStore.getState().updateScheduleItem('e1', { title: '金閣寺', start_time: '' });
    const res = await usePlanStore.getState().deleteScheduleItem('e2');
    await usePlanStore.getState().addScheduleItem(0, { title: 'カフェ', start_time: '15:30' });
    expect(res).toEqual({ ok: true, note: OFFLINE_SAVED_MESSAGE });
    const events = usePlanStore.getState().currentPlan!.days[0]!.events;
    expect(events.map((e) => e.title)).toEqual(['金閣寺', 'カフェ']);
    const q = loadQueue('p1');
    expect(q.map((o) => [o.action, o.label])).toEqual([['update', '金閣寺'], ['delete', '昼食'], ['create', 'カフェ']]);
    expect(q[0]).toMatchObject({ entity_id: 'e1', base_revision: 5, fields: { title: '金閣寺', local_start_time: null } });
    expect(q[2]!.temp_id).toBe(events[1]!.id);
    expect(q[2]!.fields).toMatchObject({ day_id: 'd1', title: 'カフェ', local_start_time: '15:30' });
    expect(usePlanStore.getState().pendingSyncCount).toBe(3);
    expect(m.toast).toHaveBeenCalledWith(OFFLINE_SAVED_MESSAGE, { icon: '📴' });
  });

  it('サーバーが答えた失敗(409など)は溜めずに元へ戻す', async () => {
    m.updateEvent.mockRejectedValue({ response: { status: 403 } });
    await usePlanStore.getState().updateScheduleItem('e1', { title: '金閣寺' });
    expect(loadQueue('p1')).toEqual([]);
    expect(usePlanStore.getState().currentPlan!.days[0]!.events[0]!.title).toBe('清水寺');
  });

  it('溜めた操作を送り、結果に応じて外し、競合の件数を覚えてプランを読み直す', async () => {
    m.deleteEvent.mockRejectedValue(NET);
    await usePlanStore.getState().deleteScheduleItem('e2');
    const [queued] = loadQueue('p1');
    m.syncOperations.mockResolvedValue({ ...fx.sync_mixed, results: [{ ...fx.sync_mixed.results[1], operation_id: queued!.operation_id }],
      summary: { applied: 0, already_applied: 0, conflicted: 1, rejected: 0 } });
    m.getPlan.mockResolvedValue({ success: true, data: { id: 'p1', title: '旅', days: [] } });
    m.getPlanDetail.mockResolvedValue({ success: true, data: { id: 'p1', title: '旅', revision: 9, days: [] } });
    await usePlanStore.getState().syncPending('p1');
    const [, ops] = m.syncOperations.mock.calls[0]!;
    expect(ops[0]).toMatchObject({ operation_id: queued!.operation_id, action: 'delete', entity_id: 'e2' });
    expect(ops[0]).not.toHaveProperty('label');
    expect(loadQueue('p1')).toEqual([]);
    expect(usePlanStore.getState()).toMatchObject({ pendingSyncCount: 0, syncConflictCount: 1, isSyncing: false });
    expect(m.toast.error).toHaveBeenCalledWith(expect.stringContaining('競合1件'));
    expect(m.getPlanDetail).toHaveBeenCalled();
  });

  it('送信中に通信が切れたら溜めたまま残す(再送しても二重に適用されない)', async () => {
    m.deleteEvent.mockRejectedValue(NET);
    await usePlanStore.getState().deleteScheduleItem('e2');
    m.syncOperations.mockRejectedValue(NET);
    await usePlanStore.getState().syncPending('p1');
    expect(loadQueue('p1')).toHaveLength(1);
    expect(usePlanStore.getState().pendingSyncCount).toBe(1);
    expect(m.toast.error).not.toHaveBeenCalled();
  });
});
