/**
 * [Gate AreaRoutes] 方面の比較で、道路の所要時間(Google Routes)を調べて片道の条件を判定する。
 * 直線距離の目安ではなく道路の時間で判定する・押した時だけ送る・やり直しは同じ Idempotency-Key。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ consultRoutes: vi.fn(), keys: [] as string[] }));
vi.mock('@/services/api/consultAi', async (orig) => ({
  ...(await orig<typeof import('@/services/api/consultAi')>()),
  consultRoutes: api.consultRoutes,
  newIdempotencyKey: () => { const k = `k${api.keys.length}`; api.keys.push(k); return k; },
}));

import { RouteCheckPanel } from './ConsultAiPanels';
import { durationLabel, routeLimit, type RouteCheck } from './consultModel';
import type { ConsultAiStatus } from '@/services/api/consultAi';

const op = { provider: 'google_routes', included: true, key_ready: true, suspended: false, reason: null, ready: true };
const STATUS = { class: 'journey', class_label: 'Journey', consent: { ai_processing: true }, stub: false, model: 'gpt-5-nano',
  max_text_chars: 3000, operations: { 'ai.generate': op, 'places.search': op, 'routes.element': op } } as unknown as ConsultAiStatus;
const AREAS = [{ name: '淡路島', latitude: 34.35, longitude: 134.85 }, { name: 'あわら温泉', latitude: 36.22, longitude: 136.19 }];
const ok = (m: number): RouteCheck => ({ status: 'ok', minutes: m, km: 150, avoidHighways: false, retrievedAt: '2026-11-03T00:00:00Z' });

describe('道路の所要時間で片道の条件を判定する', () => {
  it('routeLimit: 道路の時間が条件の内なら ✓、希望を超えたら ⚠、絶対条件を超えたら ✕(超えた分つき)', () => {
    expect(routeLimit(ok(150), 3, 'preferred')).toEqual({ status: 'within', label: '✓ 片道3時間以内(道路で確認)' });
    expect(routeLimit(ok(200), 3, 'preferred').status).toBe('over_preferred');
    expect(routeLimit(ok(200), 3, 'preferred').label).toContain('約20分超えます');
    expect(routeLimit(ok(200), 3, 'required').status).toBe('exceeds');
    expect(routeLimit(undefined, 3, 'preferred').status).toBe('unknown');
    expect(routeLimit({ ...ok(1), status: 'not_sent', minutes: null }, 3, null).status).toBe('unknown');
    expect(durationLabel(130)).toBe('2時間10分');
    expect(durationLabel(120)).toBe('2時間');
    expect(durationLabel(45)).toBe('45分');
  });
});

describe('RouteCheckPanel', () => {
  beforeEach(() => { api.consultRoutes.mockReset(); api.keys.length = 0; });

  it('押した時だけ送る。結果を方面ごとに返し、失敗のやり直しは同じキー', async () => {
    const onDone = vi.fn();
    const onUsage = vi.fn();
    api.consultRoutes
      .mockRejectedValueOnce(Object.assign(new Error('x'), { response: undefined }))
      .mockResolvedValueOnce({ results: [
        { name: '淡路島', status: 'ok', result: { duration_minutes: 95, distance_km: 120 } },
        { name: 'あわら温泉', status: 'not_sent', code: 'feature_quota_exceeded', message: '枠を使い切りました' }],
      mode: 'driving', avoid_highways: false, usage: { plan_used: '2' }, attribution: 'Google',
      retrieved_at: '2026-11-03T00:00:00Z', notice: 'Google Routes の道路の所要時間です', stub: false });
    render(<RouteCheckPanel status={STATUS} ensureSession={async () => 'sid'} originLabel="枚方"
      origin={{ latitude: 34.81, longitude: 135.65 }} areas={AREAS} avoidHighways={false} checked={0}
      onDone={onDone} onUsage={onUsage} />);
    expect(api.consultRoutes).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('consult-route-check-run'));
    expect(await screen.findByTestId('consult-route-check-error')).toHaveTextContent('直線距離の目安のまま');
    fireEvent.click(screen.getByTestId('consult-route-check-run'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    expect(api.consultRoutes.mock.calls[0]![4]).toBe(api.consultRoutes.mock.calls[1]![4]); // 届いたか分からない失敗は同じキー
    expect(api.consultRoutes.mock.calls[0]![2]).toEqual(AREAS);
    expect(onDone.mock.calls[0]![0]['淡路島']).toMatchObject({ status: 'ok', minutes: 95, km: 120 });
    expect(onDone.mock.calls[0]![0]['あわら温泉']).toMatchObject({ status: 'not_sent', message: '枠を使い切りました' });
    expect(onUsage).toHaveBeenCalled();
  });

  it('使えない理由を示して送らない(出発地の位置なし・全て調べ済み)', () => {
    const { rerender } = render(<RouteCheckPanel status={STATUS} ensureSession={async () => 'sid'} originLabel="枚方"
      origin={null} areas={AREAS} avoidHighways={false} checked={0} onDone={vi.fn()} onUsage={vi.fn()} />);
    expect(screen.getByTestId('consult-route-check-run')).toBeDisabled();
    expect(screen.getByText(/出発地の位置が照会できていません/)).toBeInTheDocument();
    rerender(<RouteCheckPanel status={STATUS} ensureSession={async () => 'sid'} originLabel="枚方"
      origin={{ latitude: 34.81, longitude: 135.65 }} areas={[]} avoidHighways={false} checked={2} onDone={vi.fn()} onUsage={vi.fn()} />);
    expect(screen.getByText(/全て調べました/)).toBeInTheDocument();
  });
});
