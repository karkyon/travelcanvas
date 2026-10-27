/** [Gate G9] ダッシュボードの応答の decoder(実 backend の応答を受理し、形が違えば ApiDecodeError)と API の呼び方。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fx from './__fixtures__/g9Responses.json';
import { ApiDecodeError } from './decode';

const api = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./index', () => ({ api }));

import { decodeDashboard } from './decodersG9';
import { getDashboard } from './g9';

beforeEach(() => api.get.mockReset());

describe('decodersG9 (実 backend の応答)', () => {
  it('旅行なし・旅行前・旅行中・旅行後・閲覧者の応答を受理する', () => {
    expect(decodeDashboard(fx.dashboard_empty).focus).toBeNull();
    const up = decodeDashboard(fx.dashboard_upcoming);
    expect(up.focus!.phase).toBe('upcoming');
    expect(up.focus!.readiness!.top.length).toBeGreaterThan(0);
    expect(up.trips.map((t) => t.phase)).toEqual(['upcoming', 'past']);
    const on = decodeDashboard(fx.dashboard_ongoing);
    expect(on.focus!.today!.next_event!.title).toBe('美術館');
    expect(on.counts).toEqual({ ongoing: 1, upcoming: 1, past: 1, undated: 0 });
    expect(decodeDashboard(fx.dashboard_past).focus!.readiness).toBeNull();
    const viewer = decodeDashboard(fx.dashboard_viewer);
    expect(viewer.trips[0]).toMatchObject({ role: 'viewer', can_edit: false });
  });

  it('形が違えば ApiDecodeError', () => {
    expect(() => decodeDashboard({ ...fx.dashboard_upcoming, trips: [{ ...fx.dashboard_upcoming.trips[0], phase: 'soon' }] }))
      .toThrow(ApiDecodeError);
    expect(() => decodeDashboard({ ...fx.dashboard_upcoming, trips: [{ ...fx.dashboard_upcoming.trips[0], role: 'admin' }] }))
      .toThrow(ApiDecodeError);
    expect(() => decodeDashboard({ ...fx.dashboard_empty, counts: { ongoing: -1, upcoming: 0, past: 0, undated: 0 } }))
      .toThrow(ApiDecodeError);
    expect(() => decodeDashboard(null)).toThrow(ApiDecodeError);
  });
});

describe('g9 の API の呼び方', () => {
  it('GET /dashboard(共通のエラー表示を出さない)', async () => {
    api.get.mockResolvedValue({ data: fx.dashboard_empty });
    await expect(getDashboard()).resolves.toMatchObject({ trips: [] });
    expect(api.get).toHaveBeenCalledWith('/dashboard', { skipGlobalErrorHandler: true });
  });
});
