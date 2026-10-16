/**
 * [Gate P12] 写真・メモ・旅行記(FR-037)APIのクライアント。送信内容(URL・If-Match・FormData・Blob・共通エラー処理を
 * 通さない指定)と、実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, createJournalDraft, createMemory, deleteMemory, getMemories, getMemoryMedia, updateMemory, uploadMemory,
} from './index';
import { decodeResponse } from './decode';
import { journalDraft, travelMemory } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({
    get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('旅の記録APIクライアント (Gate P12)', () => {
  it('一覧・メモの作成・変更(If-Match)・削除', async () => {
    let calls = respondWith(fx.memory_list);
    const list = await getMemories('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories', method: 'GET', config: { skipGlobalErrorHandler: true } });
    expect(list.memories.map((m) => m.kind)).toEqual(['note', 'photo', 'note', 'video']);
    calls = respondWith(fx.memory_note);
    await createMemory('p1', { body: 'メモ', event_id: 'e1' });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories', method: 'POST', data: { body: 'メモ', event_id: 'e1' } });
    calls = respondWith(fx.memory_updated);
    const updated = await updateMemory('p1', 'm1', { visibility: 'members' }, 1);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories/m1', method: 'PATCH', data: { visibility: 'members' },
      config: { headers: { 'If-Match': '1' }, skipGlobalErrorHandler: true } });
    expect(updated.revision).toBe(2);
    calls = respondWith(undefined);
    await deleteMemory('p1', 'm1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories/m1', method: 'DELETE' });
  });

  it('写真はFormDataで送り(Content-Typeはaxiosに任せる)、ファイルはBlobで受け取る', async () => {
    let calls = respondWith(fx.memory_photo);
    const file = new File([new Uint8Array([1, 2])], 'a.png', { type: 'image/png' });
    await uploadMemory('p1', { kind: 'photo', file, event_id: 'e1', body: '', visibility: 'members', include_in_journal: false });
    const form = calls[0]!.data as FormData;
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories/upload', config: { headers: { 'Content-Type': undefined } } });
    expect(form.get('kind')).toBe('photo');
    expect(form.get('event_id')).toBe('e1');
    expect(form.get('visibility')).toBe('members');
    expect(form.get('include_in_journal')).toBe('false');
    expect(form.has('body')).toBe(false); // 空のメモは送らない
    expect((form.get('file') as File).name).toBe('a.png');
    const blob = new Blob(['x']);
    calls = respondWith(blob);
    expect(await getMemoryMedia('p1', 'm1')).toBe(blob);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories/m1/media', config: { responseType: 'blob' } });
  });

  it('旅行記の下書き: 送る選択肢と、検査結果の列挙値の厳密な検査', async () => {
    const calls = respondWith(fx.journal_draft);
    const d = await createJournalDraft('p1', { include_locations: false, include_others: true });
    expect(calls[0]).toMatchObject({ url: '/plans/p1/memories/journal-draft', data: { include_locations: false, include_others: true } });
    expect(d.summary.planned_events).toBe(2);
    expect(d.checks.map((c) => c.code)).toEqual(['member_name', 'reservation_like', 'photo_people', 'location_excluded']);
    const bad = { ...fx.journal_draft, checks: [{ ...fx.journal_draft.checks[0], code: 'face_detected' }] };
    expect(() => decodeResponse(bad, journalDraft, 'x')).toThrow(/\$\.checks\[0\]\.code/);
    expect(() => decodeResponse({ ...fx.memory_note, visibility: 'public' }, travelMemory, 'x')).toThrow(/\$\.visibility/);
  });
});
