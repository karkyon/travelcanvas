import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

const { post } = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('axios', async (orig) => {
  const real = (await orig()) as typeof import('axios');
  return { default: { ...real.default, create: () => ({ post }), isAxiosError: real.default.isAxiosError } };
});

import { createQuickDraft, getStoredDeviceToken } from './quickDraftApi';

const KEY = 'travelcanvas_quickdraft_device_token';
const payload = { title: '桂川日帰り', start_date: '2026-11-22', end_date: '2026-11-22', events: [] };
const ok = (token?: string) => ({ data: { id: 'd1', revision: 1, status: 'draft', expires_at: '', start_date: '2026-11-22',
  end_date: '2026-11-22', events: [], ...(token ? { device_token: token } : {}) } });
const unauthorized = () => {
  const e = new axios.AxiosError('401', 'ERR_BAD_REQUEST');
  e.response = { status: 401, data: {}, statusText: '', headers: {}, config: {} as never };
  return e;
};

describe('createQuickDraft', () => {
  beforeEach(() => { post.mockReset(); localStorage.clear(); });
  afterEach(() => localStorage.clear());

  it('端末に残った古い token が 401 の時は捨てて、token なしで 1 回だけやり直す', async () => {
    localStorage.setItem(KEY, 'old-token');
    post.mockRejectedValueOnce(unauthorized()).mockResolvedValueOnce(ok('new-token'));
    const r = await createQuickDraft(payload, 'idem-1');
    expect(r.id).toBe('d1');
    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]![2].headers.Authorization).toBe('Bearer old-token');
    expect(post.mock.calls[1]![2].headers.Authorization).toBeUndefined();
    expect(getStoredDeviceToken()).toBe('new-token');
  });

  it('token が無い時の 401・401 以外の失敗はやり直さない', async () => {
    post.mockRejectedValueOnce(unauthorized());
    await expect(createQuickDraft(payload, 'idem-2')).rejects.toBeTruthy();
    localStorage.setItem(KEY, 't');
    const e500 = unauthorized(); e500.response!.status = 500;
    post.mockRejectedValueOnce(e500);
    await expect(createQuickDraft(payload, 'idem-3')).rejects.toBeTruthy();
    expect(post).toHaveBeenCalledTimes(2);
    expect(getStoredDeviceToken()).toBe('t');
  });
});
