/** [FR-062] 圏外で溜めた「今度行きたい」(pending_wishes)。古い順に送り、通信の失敗で止め、断られた物だけ捨てる */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const m = vi.hoisted(() => ({ store: new Map<string, unknown>(), quick: vi.fn() }));
vi.mock('./offlineVault', () => ({
  loadSnapshot: async (_s: unknown, name: string) => (m.store.has(name) ? { data: m.store.get(name), savedAt: 0 } : null),
  saveSnapshot: async (_s: unknown, name: string, data: unknown) => { m.store.set(name, data); return true; },
}));
vi.mock('@/services/api/spotIntake', () => ({ quickSaveWish: m.quick }));

import { flushWishQueue, loadWishQueue, queueWish, newClientId } from './wishQueue';

const session = { userId: 'u1', sessionTag: 't' };
const wish = (name: string) => ({ name, wish_kind: 'next' as const, source_kind: 'quick' as const, client_id: newClientId() });

beforeEach(() => { m.store.clear(); m.quick.mockReset(); });

describe('pending_wishes', () => {
  it('同じ client_id は 1 件だけ溜める', async () => {
    const w = wish('A');
    await queueWish(session, w);
    await queueWish(session, w);
    expect(await loadWishQueue(session)).toHaveLength(1);
  });

  it('古い順に送り、送れた物を消す', async () => {
    const a = wish('A');
    await queueWish(session, a);
    await new Promise((r) => setTimeout(r, 2));
    await queueWish(session, wish('B'));
    m.quick.mockResolvedValue({});
    expect(await flushWishQueue(session)).toEqual({ sent: 2, dropped: 0, left: 0 });
    expect(m.quick.mock.calls.map((c) => c[0].name)).toEqual(['A', 'B']);
    expect(m.quick.mock.calls[0]![0]).not.toHaveProperty('queuedAt');
    expect(m.quick.mock.calls[0]![0].client_id).toBe(a.client_id);
  });

  it('通信の失敗・5xx で止めて残し、内容を断られた物(422)は捨てる', async () => {
    await queueWish(session, wish('A'));
    await queueWish(session, wish('B'));
    await queueWish(session, wish('C'));
    m.quick.mockRejectedValueOnce({ response: { status: 422 } })
      .mockRejectedValueOnce({ response: { status: 503 } });
    expect(await flushWishQueue(session)).toEqual({ sent: 0, dropped: 1, left: 2 });
    expect((await loadWishQueue(session)).map((w) => w.name)).toEqual(['B', 'C']);
  });

  it('client_id はサーバーの形(英数字 16 字以上)', () => {
    expect(newClientId()).toMatch(/^[A-Za-z0-9]{16,64}$/);
  });
});
