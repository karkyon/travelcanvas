/** [Gate Remaining-1] 通信できない時の写真・ひとことの送信待ち */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = new Map<string, unknown>();
vi.mock('./offlineVault', () => ({
  saveSnapshot: vi.fn(async (_s: unknown, name: string, data: unknown) => { store.set(name, data); return true; }),
  loadSnapshot: vi.fn(async (_s: unknown, name: string) => (store.has(name) ? { data: store.get(name), savedAt: 1 } : null)),
}));
const addNote = vi.fn();
const addMedia = vi.fn();
vi.mock('@/services/api/travelDay', () => ({ addNote: (...a: unknown[]) => addNote(...a), addMedia: (...a: unknown[]) => addMedia(...a) }));

import { MEMO_QUEUE_MAX, flushMemoQueue, loadMemoQueue, queueMemo } from './memoQueue';

const S = { userId: 'u', sessionTag: 't' };
const base = { eventId: 'e1', dayId: 'd1', visibility: 'private' as const, placeName: '湖', includeInJournal: true, body: null };

describe('memoQueue', () => {
  beforeEach(() => { store.clear(); addNote.mockReset(); addMedia.mockReset(); });

  it('置いた順に送り、元の時刻で記録する。写真は元の中身に戻して送る', async () => {
    const photo = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
    expect(await queueMemo(S, 'p', { ...base, kind: 'photo', file: photo })).toEqual({ ok: true, count: 1 });
    expect(await queueMemo(S, 'p', { ...base, kind: 'note', body: '風が気持ちいい' })).toEqual({ ok: true, count: 2 });
    expect((await loadMemoQueue(S, 'p')).map((m) => m.kind)).toEqual(['photo', 'note']);
    addMedia.mockResolvedValue({});
    addNote.mockResolvedValue({});
    expect(await flushMemoQueue(S, 'p')).toEqual({ sent: 2, dropped: 0, left: 0 });
    const sentFile = addMedia.mock.calls[0]![1].file as File;
    const bytes = await new Promise<ArrayBuffer>((res) => { const r = new FileReader(); r.onload = () => res(r.result as ArrayBuffer); r.readAsArrayBuffer(sentFile); });
    expect(Array.from(new Uint8Array(bytes))).toEqual([1, 2, 3]);
    expect(sentFile.name).toBe('a.jpg');
    expect(addNote.mock.calls[0]![1]).toMatchObject({ body: '風が気持ちいい', event_id: 'e1', include_in_journal: true });
    expect(addNote.mock.calls[0]![1].occurred_at).toMatch(/^\d{4}-/);
    expect(await loadMemoQueue(S, 'p')).toEqual([]);
  });

  it('通信できない失敗で止めて残し、サーバーが断った物は捨てる', async () => {
    await queueMemo(S, 'p', { ...base, kind: 'note', body: 'a' });
    await queueMemo(S, 'p', { ...base, kind: 'note', body: 'b' });
    await queueMemo(S, 'p', { ...base, kind: 'note', body: 'c' });
    addNote.mockRejectedValueOnce({ response: { status: 403 } }).mockRejectedValueOnce({ code: 'ERR_NETWORK' });
    expect(await flushMemoQueue(S, 'p')).toEqual({ sent: 0, dropped: 1, left: 2 });
    expect((await loadMemoQueue(S, 'p')).map((m) => m.body)).toEqual(['b', 'c']);
  });

  it('数と大きさの上限を超えたら置かない', async () => {
    for (let i = 0; i < MEMO_QUEUE_MAX; i += 1) await queueMemo(S, 'p', { ...base, kind: 'note', body: String(i) });
    expect(await queueMemo(S, 'p', { ...base, kind: 'note', body: 'x' })).toEqual({ ok: false, reason: 'full' });
    const big = { size: 16 * 1024 * 1024, name: 'b.jpg', type: 'image/jpeg' } as File;
    expect(await queueMemo(S, 'q', { ...base, kind: 'photo', file: big })).toEqual({ ok: false, reason: 'too_large' });
  });
});
