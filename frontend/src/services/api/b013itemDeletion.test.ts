/**
 * [Gate B-013] 予定・日程・経路候補・共同編集者の個別削除APIのクライアント。
 * 実backendから採取した応答(__fixtures__)を受理し、件数の形が崩れた応答を拒否することを固定する。
 */
import { describe, it, expect } from 'vitest';
import fx from './__fixtures__/backendContractResponses.json';
import { ApiDecodeError } from './decode';
import { api } from './index';
import type { LockedRelationDetail, MinimalHttpClient, UndoConflictDetail } from './types';

type Call = { url: string; method: string; ifMatch?: string };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const make = (method: string) => async (url: string, config?: { headers?: Record<string, string> }) => {
    calls.push({ url, method, ifMatch: config?.headers?.['If-Match'] });
    return { data };
  };
  const client: Partial<MinimalHttpClient> = { delete: make('DELETE') };
  api.setHttpClientForTesting(client);
  return calls;
}

describe('個別削除APIクライアント (Gate B-013)', () => {
  it('予定の削除は外した紐付けの件数(detached)を含む実応答を受理する', async () => {
    const calls = respondWith(fx.event_deleted_detached);
    const result = await api.deleteEvent('p1', 'e1', 7);
    expect(calls).toEqual([{ url: '/plans/p1/events/e1', method: 'DELETE', ifMatch: '7' }]);
    expect(result.revision).toBe(fx.event_deleted_detached.revision);
    expect(result.detached).toEqual(fx.event_deleted_detached.detached);
  });

  it('日程の削除も同じ形で受理し、detachedが無い旧応答も受理する', async () => {
    respondWith(fx.day_deleted);
    await expect(api.deleteDay('p1', 'd1', 8)).resolves.toMatchObject({ detached: fx.day_deleted.detached });
    respondWith({ revision: 3 });
    await expect(api.deleteDay('p1', 'd1', 2)).resolves.toEqual({ revision: 3 });
  });

  it('件数が負数・小数・文字列の応答は拒否する', async () => {
    for (const bad of [-1, 1.5, '1']) {
      respondWith({ revision: 3, detached: { ...fx.event_deleted_detached.detached, reservations_unlinked: bad } });
      await expect(api.deleteEvent('p1', 'e1', 2)).rejects.toThrow(/\$\.detached\.reservations_unlinked/);
    }
    respondWith({ revision: 3, detached: { reservations_unlinked: 1 } });
    await expect(api.deleteEvent('p1', 'e1', 2)).rejects.toBeInstanceOf(ApiDecodeError);
  });

  it('採用済み経路候補の削除は、残した移動区間の件数を返す', async () => {
    const calls = respondWith(fx.route_option_deleted_adopted);
    const result = await api.deleteRouteOption('p1', 'o1', 6);
    expect(calls).toEqual([{ url: '/plans/p1/route-options/o1', method: 'DELETE', ifMatch: '6' }]);
    expect(result.detached?.segments_unlinked).toBe(1);
  });

  it('共同編集者の削除は、外したチケット担当・参加者の件数を返す', async () => {
    const calls = respondWith(fx.collaborator_removed);
    const result = await api.removeCollaborator('p1', 'c1');
    expect(calls).toEqual([{ url: '/travel-plans/p1/collaborators/c1', method: 'DELETE', ifMatch: undefined }]);
    expect(result.data).toEqual(fx.collaborator_removed);
    respondWith({ detail: 'x' });
    await expect(api.removeCollaborator('p1', 'c1')).rejects.toThrow(/\$\.success/);
  });

  it('409の構造化detail(確定ロック・Undo競合)は型定義どおりの形である', () => {
    const locked = fx.event_delete_locked_409.detail as LockedRelationDetail;
    expect(locked.code).toBe('locked_relation');
    expect(locked.blocking[0]).toEqual(expect.objectContaining({ type: 'event_reservation', reason: 'locked' }));
    const undo = fx.undo_conflict_409.detail as UndoConflictDetail;
    expect(undo.code).toBe('undo_conflict');
    expect(undo.conflicts).toHaveLength(1);
  });
});
