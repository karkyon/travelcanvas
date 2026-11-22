/**
 * [FR-061] ルートと寄り道: 幅・ジャンルの札の送信・並べの切り替え・0 件・直線・圏外・予定に入れた後の見込み。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';

const m = vi.hoisted(() => ({ view: vi.fn(), along: vi.fn(), cmp: vi.fn(), route: vi.fn(), add: vi.fn(), plan: vi.fn(),
  load: vi.fn(), save: vi.fn() }));
vi.mock('@/services/api/dayTrip', async (orig) => ({ ...(await orig<typeof import('@/services/api/dayTrip')>()),
  getDayTrip: m.view, getAlong: m.along, compareRoads: m.cmp, computeDayTripRoute: m.route }));
vi.mock('@/services/api/travelDay', () => ({ addDetourEvent: m.add }));
vi.mock('@/services/api', () => ({ api: { getPlanDetail: m.plan } }));
vi.mock('@/utils/offlineVault', () => ({ loadSnapshot: m.load, saveSnapshot: m.save }));
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => null }));
vi.mock('@/components/wishes/WishSaveButton', () => ({ default: () => <button type="button">♡ 今度行きたい</button> }));
vi.mock('./dayTrip/DayTripMap', () => ({ default: () => <div data-testid="map" /> }));

import DayTripPage from './DayTripPage';

const leg = (k: 'out' | 'back', o: Record<string, unknown> = {}) => ({ leg: k, origin: { label: '現在地のあたり', lat: 34.99, lng: 135.7 },
  destination: { label: '桂坂野鳥遊園', lat: 34.98, lng: 135.66 }, road: 'highway', depart_at: k === 'out' ? '09:00' : '16:30', home_by: '19:00',
  polyline: '_p~iF~ps|U_ulLnnqC', distance_m: 48000, duration_s: 4320, toll_jpy: 1320, provider: 'google',
  arrive_at: k === 'out' ? '10:12' : '17:42', computed_at: '', revision: 1, ...o });
const result = { name: '森のカフェ', genre: 'cafe', genre_label: 'カフェ', lat: 34.98, lng: 135.68, address: '京都市', off_m: 300, at_km: 12,
  detour_min: 6, exit_unknown: false, providers: ['yahoo_local'], saved_spot_id: null, stay_min: 40, score: 0.8, reasons: ['よく行く: カフェ(5 回)'] };
const along = (o: Record<string, unknown> = {}) => ({ region_label: '', width_m: 1000, leg: 'out', total_km: 48, results: [result],
  wishes_near: [{ spot_id: 's', name: '滝', lat: 0, lng: 0, off_m: 100, at_km: 3, wish_kind: 'next' }],
  profile_line: 'よく行く: カフェ 5・神社 3 · また行きたい: 温泉', personalized: true, source: [], keyed_providers: ['yahoo_local'],
  failed_providers: [], straight: false, cached: false, ...o });

const renderPage = () => render(<MemoryRouter initialEntries={['/planner/p1/day-trip']}><Routes>
  <Route path="/planner/:planId/day-trip" element={<DayTripPage />} /></Routes></MemoryRouter>);

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.view.mockResolvedValue({ trip_style: 'day_trip', routes: { out: leg('out'), back: leg('back') } });
  m.along.mockResolvedValue(along());
  m.cmp.mockResolvedValue({ options: [{ road: 'highway', duration_s: 4320, distance_m: 48000, toll_jpy: 1320, polyline: '', provider: 'google', warnings: [] },
    { road: 'local', duration_s: 6360, distance_m: 41000, toll_jpy: null, polyline: '', provider: 'google', warnings: [] }] });
  m.save.mockResolvedValue(true);
  m.plan.mockResolvedValue({ data: { days: [{ id: 'd1' }] } });
  m.add.mockResolvedValue({});
});

describe('ルートと寄り道 (FR-061)', () => {
  it('比べの 2 枚・傾向・保存した場所の数・行の文と理由', async () => {
    renderPage();
    expect(await screen.findByText('森のカフェ', { exact: false })).toBeTruthy();
    expect(screen.getByRole('button', { name: /高速 1時間12分 · 48km/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /下道 1時間46分 · 41km/ })).toHaveTextContent('料金なし');
    expect(screen.getByTestId('dt-profile')).toHaveTextContent('よく行く: カフェ 5');
    expect(screen.getByTestId('dt-wishes')).toHaveTextContent('ルートの近くに 1 件');
    expect(screen.getByText('ルートから 300m · 寄り道 +6分 · 12km 目')).toBeTruthy();
    expect(screen.getByText('よく行く: カフェ(5 回)')).toBeTruthy();
    expect(screen.getByTestId('dt-badge')).toHaveTextContent('幅 1km · 線の近く 1 件');
  });

  it('幅・ジャンル・並べ・好みの切を送る', async () => {
    renderPage();
    await screen.findByText('森のカフェ', { exact: false });
    expect(m.along).toHaveBeenLastCalledWith('p1', { leg: 'out', genres: ['cafe'], width_m: 1000, order: 'personal' });
    fireEvent.click(screen.getByTestId('dt-genre-onsen'));
    await waitFor(() => expect(m.along).toHaveBeenLastCalledWith('p1', expect.objectContaining({ genres: ['cafe', 'onsen'] })));
    fireEvent.click(screen.getByTestId('dt-width-3000'));
    await waitFor(() => expect(m.along).toHaveBeenLastCalledWith('p1', expect.objectContaining({ width_m: 3000 })));
    fireEvent.change(screen.getByLabelText('並べ'), { target: { value: 'detour' } });
    await waitFor(() => expect(m.along).toHaveBeenLastCalledWith('p1', expect.objectContaining({ order: 'detour' })));
    fireEvent.change(screen.getByLabelText('並べ'), { target: { value: 'personal' } });
    fireEvent.click(screen.getByTestId('dt-personal'));
    await waitFor(() => expect(m.along).toHaveBeenLastCalledWith('p1', expect.objectContaining({ order: 'route' })));
    expect(screen.queryByTestId('dt-profile')).toBeNull();
  });

  it('0 件は幅を 1 段広げるボタン、直線は札', async () => {
    m.view.mockResolvedValue({ trip_style: 'day_trip', routes: { out: leg('out', { provider: 'straight' }), back: leg('back') } });
    m.along.mockResolvedValue(along({ results: [], wishes_near: [] }));
    renderPage();
    expect(await screen.findByTestId('dt-empty')).toHaveTextContent('この幅では見つかりませんでした');
    expect(screen.getByTestId('dt-straight')).toHaveTextContent('道路のルートではありません(直線)');
    fireEvent.click(screen.getByRole('button', { name: '幅を 3km に広げる' }));
    await waitFor(() => expect(m.along).toHaveBeenLastCalledWith('p1', expect.objectContaining({ width_m: 3000 })));
  });

  it('圏外は前に取った結果と時刻', async () => {
    m.along.mockRejectedValue(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK', isAxiosError: true }));
    m.load.mockResolvedValue({ data: { leg: 'out', r: along() }, savedAt: new Date(2026, 10, 28, 8, 5).getTime() });
    renderPage();
    expect(await screen.findByTestId('dt-offline')).toHaveTextContent('通信できないため、前に取った結果です(08:05)');
    expect(screen.getByText('森のカフェ', { exact: false })).toBeTruthy();
  });

  it('予定に入れると、着く見込みの時刻で入れ、家に着く見込みが遅れる', async () => {
    renderPage();
    await screen.findByText('森のカフェ', { exact: false });
    expect(screen.getByTestId('dt-eta')).toHaveTextContent('家に着く見込み 17:42(19:00 まで あと 78 分)');
    await act(async () => { fireEvent.click(screen.getByTestId('dt-add-0')); });
    expect(m.add).toHaveBeenCalledWith('p1', expect.objectContaining({ day_id: 'd1', title: '森のカフェ', local_start_time: '09:18',
      local_end_time: '09:58' }));
    expect(screen.getByTestId('dt-eta')).toHaveTextContent('家に着く見込み 18:28(19:00 まで あと 32 分)');
  });

  it('日帰りでない旅行・ルートが無い時', async () => {
    m.view.mockResolvedValueOnce({ trip_style: null, routes: {} });
    const { unmount } = renderPage();
    expect(await screen.findByText(/この旅行は日帰りではありません/)).toBeTruthy();
    unmount();
    m.view.mockResolvedValueOnce({ trip_style: 'day_trip', routes: {} });
    renderPage();
    expect(await screen.findByTestId('dt-no-route')).toHaveTextContent('ルートを計算できませんでした');
  });
});
