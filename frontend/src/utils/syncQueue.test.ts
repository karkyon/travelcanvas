/**
 * [Gate P11] オフライン編集の操作キュー(syncQueue)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { SyncResult } from '@/services/api';
import {
  applyResults, deviceId, enqueue, isNetworkError, loadConflictCount, loadQueue, saveConflictCount, toPayload,
} from './syncQueue';

beforeEach(() => localStorage.clear());

describe('syncQueue (Gate P11)', () => {
  it('溜めた順に保存し、送信する形では画面用のlabelと未指定の項目を除く', () => {
    const a = enqueue('p1', { action: 'create', temp_id: 'event_temp_1', label: 'カフェ',
      fields: { day_id: 'd1', title: 'カフェ', description: undefined, local_start_time: null } });
    const b = enqueue('p1', { action: 'update', entity_id: 'event_temp_1', base_revision: 3, label: '喫茶店', fields: { title: '喫茶店' } });
    expect(loadQueue('p1').map((o) => o.operation_id)).toEqual([a!.operation_id, b!.operation_id]);
    expect(loadQueue('p2')).toEqual([]);
    const payload = toPayload(loadQueue('p1'));
    expect(payload[0]).not.toHaveProperty('label');
    expect(payload[0]!.fields).toEqual({ day_id: 'd1', title: 'カフェ', local_start_time: null });
    expect(payload[1]).toMatchObject({ action: 'update', entity_id: 'event_temp_1', base_revision: 3 });
  });

  it('送信結果を当てる: 終わった操作を外し、残りの仮IDを本当のIDへ置き換える', () => {
    const create = enqueue('p1', { action: 'create', temp_id: 'event_temp_1', label: 'x', fields: { day_id: 'd', title: 'x' } })!;
    const later = enqueue('p1', { action: 'delete', entity_id: 'event_temp_1', base_revision: 3, label: 'x' })!;
    const results: SyncResult[] = [{ operation_id: create.operation_id, status: 'applied', code: null, message: null,
      entity_id: 'real-1', temp_id: 'event_temp_1', resulting_revision: 4, conflict: null }];
    const remaining = applyResults('p1', results);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ operation_id: later.operation_id, entity_id: 'real-1' });
    // 実応答(競合・拒否を含む)でも、処理が終わった操作は全て外す
    const r = fx.sync_mixed.results as SyncResult[];
    localStorage.setItem('tc_sync_queue_p9', JSON.stringify(r.map((x) => ({ operation_id: x.operation_id, entity_type: 'event',
      action: 'update', label: 'x' }))));
    expect(applyResults('p9', r)).toEqual([]);
  });

  it('壊れた保存内容・使えないストレージでも画面を止めない', () => {
    localStorage.setItem('tc_sync_queue_p1', '{broken');
    expect(loadQueue('p1')).toEqual([]);
    localStorage.setItem('tc_sync_queue_p1', JSON.stringify([{ foo: 1 }, { operation_id: 'o', entity_type: 'event', action: 'delete', label: 'x' }]));
    expect(loadQueue('p1')).toHaveLength(1);
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota'); });
    expect(enqueue('p3', { action: 'delete', entity_id: 'e', base_revision: 1, label: 'x' })).toBeNull();
    spy.mockRestore();
    saveConflictCount('p1', 2);
    expect(loadConflictCount('p1')).toBe(2);
    saveConflictCount('p1', 0);
    expect(loadConflictCount('p1')).toBe(0);
    expect(deviceId()).toBe(deviceId());
  });

  it('通信できなかった失敗だけを溜める対象にする', () => {
    expect(isNetworkError({ code: 'ERR_NETWORK', message: 'Network Error' })).toBe(true);
    expect(isNetworkError({ message: 'Network Error' })).toBe(true);
    expect(isNetworkError({ response: { status: 409 }, code: 'ERR_BAD_REQUEST' })).toBe(false);
    expect(isNetworkError(new Error('x'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });

  it('[Gate G6] 日程の作成・並べ替えも溜め、仮の日程・予定のIDを並びの中でも置き換える', () => {
    const day = enqueue('p1', { entity_type: 'day', action: 'create', temp_id: 'day_temp_1', label: '3日目',
      fields: { local_date: '2026-11-03', timezone_id: 'Asia/Tokyo' } })!;
    const ev = enqueue('p1', { action: 'create', temp_id: 'event_temp_1', label: 'x', fields: { day_id: 'day_temp_1', title: 'x' } })!;
    const order = enqueue('p1', { entity_type: 'order', action: 'reorder', entity_id: 'day_temp_1', base_revision: 2,
      label: '並び', fields: { order: ['event_temp_1', 'e-real'] } })!;
    expect(loadQueue('p1').map((o) => o.entity_type)).toEqual(['day', 'event', 'order']);
    const remaining = applyResults('p1', [
      { operation_id: day.operation_id, status: 'applied', code: null, message: null, entity_id: 'day-real', temp_id: 'day_temp_1',
        resulting_revision: 3, conflict: null },
      { operation_id: ev.operation_id, status: 'applied', code: null, message: null, entity_id: 'ev-real', temp_id: 'event_temp_1',
        resulting_revision: 4, conflict: null },
    ]);
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ operation_id: order.operation_id, entity_id: 'day-real',
      fields: { order: ['ev-real', 'e-real'] } });
    // 対象と操作の組が合わない保存内容は捨てる
    localStorage.setItem('tc_sync_queue_p3', JSON.stringify([{ operation_id: 'x', entity_type: 'order', action: 'update', label: 'x' },
      { operation_id: 'y', entity_type: 'reservation', action: 'update', label: 'x' }]));
    expect(loadQueue('p3')).toEqual([]);
  });
});
