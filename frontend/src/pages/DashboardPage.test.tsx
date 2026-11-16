/**
 * [Gate M9-FE-B3] 表示中に未認証へ変わった場合もログイン画面へ遷移する(読み込みはマウント時の1回だけ)。
 * [Gate G9] UX-4 文脈型ダッシュボード: 読み込み中・失敗(再試行)・オフライン(つながったら読み直す)・旅行なし・旅行前・
 * 旅行中・旅行後・閲覧のみ(招待を出さない)・暗い見た目。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fx from '../services/api/__fixtures__/g9Responses.json';
import { decodeDashboard } from '../services/api/decodersG9';

const { getDashboard, setTripState } = vi.hoisted(() => ({ getDashboard: vi.fn(), setTripState: vi.fn() }));
vi.mock('../services/api/g9', () => ({ getDashboard, setTripState }));
// [Gate MemoryReel] ホームの思い出リールの材料(写真なし・予定の名前で流す)
const { getMemoryReel } = vi.hoisted(() => ({ getMemoryReel: vi.fn() }));
vi.mock('../services/api/memoryReel', () => ({ getMemoryReel }));
// [Gate HomeLive] 旅行中のホームは今日の画面と同じ GET /plans/{id}/today を読む
const { getToday } = vi.hoisted(() => ({ getToday: vi.fn() }));
vi.mock('@/services/api', async (orig) => ({ ...(await orig<typeof import('@/services/api')>()), getToday }));

import { useThemeStore } from '@/hooks/useThemePreference';
import DashboardPage from './DashboardPage';
import { useAuthStore } from '../store/authStore';
import type { User } from '../types';

const renderDashboard = () =>
  render(
    <MemoryRouter initialEntries={['/dashboard']}>
      <Routes>
        <Route path="/dashboard" element={<DashboardPage />} />
        <Route path="/login" element={<div>LOGIN-SCREEN</div>} />
      </Routes>
    </MemoryRouter>
  );

// トークンも入れる(トークンの無い会員だと authStore の初期化が /auth/refresh を本当に呼ぶ)
const login = () => useAuthStore.setState({
  isAuthenticated: true, isGuest: false, token: 'test-access-token', isInitialized: true,
  user: { id: 'u-1', username: 'alice', email: 'a@example.com' } as unknown as User,
});

const setOnline = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

describe('DashboardPage', () => {
  beforeEach(() => {
    getDashboard.mockReset();
    getMemoryReel.mockReset();
    getToday.mockReset();
    getToday.mockRejectedValue(new Error('offline'));
    getMemoryReel.mockImplementation(async (planId: string) => ({
      plan_id: planId, title: '思い出', destination: '奈良', start_date: '2026-10-01', end_date: '2026-10-02', day_count: 2,
      photo_count: 0, note_count: 0, place_count: 0, member_count: 1, quote: null, slides: [],
      fallback_events: [{ title: '東大寺', local_date: '2026-10-01', local_time: '10:00' }],
    }));
    setOnline(true);
    try { window.localStorage.removeItem('tc.theme'); } catch { /* 保存できない環境 */ }
  });

  it('未認証ならログイン画面へ遷移し、読み込まない', async () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    renderDashboard();
    expect(await screen.findByText('LOGIN-SCREEN')).toBeInTheDocument();
    expect(getDashboard).not.toHaveBeenCalled();
  });

  it('表示中に未認証へ変わった場合もログイン画面へ遷移し、読み込みはマウント時の1回だけ', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_empty));
    login();
    renderDashboard();
    await waitFor(() => expect(getDashboard).toHaveBeenCalledTimes(1));
    act(() => { useAuthStore.setState({ isAuthenticated: false, user: null }); });
    expect(await screen.findByText('LOGIN-SCREEN')).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledTimes(1);
  });

  it('読み込み中 → 旅行なしは「旅行を始める」案内', async () => {
    let resolve: (v: unknown) => void = () => {};
    getDashboard.mockReturnValue(new Promise((r) => { resolve = r; }));
    login();
    renderDashboard();
    expect(screen.getByTestId('dashboard-loading')).toHaveAttribute('role', 'status');
    await act(async () => { resolve(decodeDashboard(fx.dashboard_empty)); });
    const hero = await screen.findByTestId('dashboard-hero');
    expect(hero).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'この旅行の操作' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '旅行' })).not.toBeInTheDocument();
  });

  it('旅行前: 表紙・準備・遅延と休業・招待を含む操作・段階ごとの一覧', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_upcoming));
    login();
    renderDashboard();
    const hero = await screen.findByTestId('dashboard-hero');
    expect(hero).toHaveAttribute('data-phase', 'upcoming');
    expect(within(hero).getByRole('heading', { level: 2 })).toHaveTextContent('京都 紅葉の旅');
    expect(screen.getByTestId('dashboard-readiness')).toBeInTheDocument();
    expect(screen.getByTestId('dashboard-alerts')).toBeInTheDocument();
    const actions = screen.getByRole('navigation', { name: 'この旅行の操作' });
    expect(within(actions).getAllByRole('link').length).toBeLessThanOrEqual(4);
    expect(within(actions).getByRole('link', { name: /一緒に行く人を招く/ })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '旅行前の旅行' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '旅行後の旅行' })).toBeInTheDocument();
  });

  it('[HomeV2] いま計画中(旅の準備・次にやること)・旅行の一覧のタブ・旅の記録と思い出・足あと・行ってみたい場所・道具', async () => {
    const base = fx.dashboard_upcoming as unknown as { trips: Array<Record<string, unknown>> } & Record<string, unknown>;
    const up = base.trips.find((t) => t.phase === 'upcoming')!;
    const past = base.trips.find((t) => t.phase === 'past')!;
    const raw = {
      ...base,
      trips: base.trips.map((t) => ({ ...t, shelf: t.phase === 'past' ? 'visited' : 'planning', event_count: 3, photo_count: 0,
        note_count: 0 })),
      home: {
        shelves: { planning: 1, considering: 0, visited: 1, cancelled: 0 },
        planning: [{ plan_id: up.id, event_count: 3, segments: { need: 2, done: 1 }, done: 3, total: 5, tasks: [], steps: [
          { key: 'dates', label: '行き先と日付', done: true }, { key: 'places', label: '立ち寄る場所(3 件)', done: true },
          { key: 'moves', label: '移動手段(あと 1 区間)', done: false }, { key: 'ready', label: '予約・確認', done: true },
          { key: 'packing', label: '持ち物', done: false }] }],
        tasks: [{ plan_id: up.id, trip_title: up.title, kind: 'moves', severity: 'normal', title: '移動手段を決める(1 区間)',
          to: `/planner/${up.id}`, action: '旅程へ' }],
        memories: { recent: { plan_id: past.id, photo_ids: [] }, timeline: [{ plan_id: past.id, title: past.title,
          start_date: past.start_date, end_date: past.end_date, photo_count: 0, note_count: 2, cover: null }] },
        footprints: { prefectures: ['京都府'], planned_prefectures: ['三重県'], all_prefectures: [], trips_visited: 1,
          days_this_year: 2, photos: 0 },
        wishlist: { count: 1, groups: [{ category: 'restaurant', count: 1, spots: [{ spot_id: 's1', name: '伊勢うどん', prefecture: '三重県' }] }] },
      },
    };
    getDashboard.mockResolvedValue(decodeDashboard(raw));
    setTripState.mockResolvedValue(undefined);
    login();
    renderDashboard();
    const progress = await screen.findByTestId('home-progress');
    expect(progress).toHaveTextContent('旅の準備 3 / 5');
    expect(screen.getByTestId('home-step-moves')).toHaveAttribute('data-done', 'false');
    expect(screen.getByTestId('home-tasks')).toHaveTextContent('移動手段を決める(1 区間)');
    expect(screen.queryByTestId('dashboard-readiness')).toBeNull();  // 準備は「次にやること」にまとめた
    const shelf = screen.getByTestId('home-shelf');
    expect(within(shelf).getByRole('tab', { name: /計画中/ })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(within(shelf).getByRole('tab', { name: /行った旅/ }));
    expect(within(shelf).getByRole('list', { name: '行った旅の旅行' })).toHaveTextContent(past.title as string);
    fireEvent.click(within(shelf).getByRole('tab', { name: /計画中/ }));
    // [Gate ShelfCards] 見送りは「…」の中
    fireEvent.click(screen.getByTestId(`home-more-${up.id}`));
    fireEvent.click(screen.getByTestId(`home-state-${up.id}`));
    await waitFor(() => expect(setTripState).toHaveBeenCalledWith(up.id, 'cancelled'));
    expect(screen.getByTestId('home-memories')).toHaveTextContent(`${past.title as string}`);
    // [Gate MemoryReel] 行った旅の思い出リール(写真が無い旅は予定の名前を流す)
    expect(await within(screen.getByTestId('home-memories')).findByTestId('memory-reel')).toHaveTextContent('東大寺');
    expect(getMemoryReel).toHaveBeenCalledWith(past.id);
    expect(screen.getByTestId('home-footprints')).toHaveTextContent('1/47');
    expect(screen.getByTestId('home-wishlist')).toHaveTextContent('伊勢うどん');
    expect(screen.getByTestId('home-tools')).toHaveTextContent('スポット検索');
    // [Gate HomeTitle] 「おかえりなさい」は使わない
    expect(screen.getByRole('heading', { level: 1 })).not.toHaveTextContent('おかえりなさい');
  });

  it('[HomeSwitch] 計画中が 2 件以上なら、大きな表紙のすぐ下で表示する旅行を切り替えられる', async () => {
    const base = fx.dashboard_upcoming as unknown as { trips: Array<Record<string, unknown>> } & Record<string, unknown>;
    const up = base.trips.find((t) => t.phase === 'upcoming')!;
    const other: Record<string, unknown> = { ...up, id: 'p-other', title: '滋賀・1泊2日の旅程案', days_until_start: 46 };
    getDashboard.mockResolvedValue(decodeDashboard({ ...base,
      trips: [...base.trips, other].map((t) => ({ ...t, shelf: t.phase === 'past' ? 'visited' : 'planning' })) }));
    login();
    renderDashboard();
    const sw = await screen.findByTestId('home-switcher');
    expect(sw).toHaveTextContent('表示する旅行を切り替え');
    expect(screen.getByTestId('dashboard-hero').nextElementSibling).toBe(sw);
    expect(within(sw).getByTestId(`home-switch-${up.id as string}`)).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(sw).getByTestId('home-switch-p-other'));
    expect(await screen.findByRole('heading', { level: 2, name: '滋賀・1泊2日の旅程案' })).toBeInTheDocument();
    expect(within(sw).getByTestId('home-switch-p-other')).toHaveAttribute('aria-pressed', 'true');
  });

  it('旅行中: NOW/NEXT(現地の時刻・残り時間)。今日の予定を読めない時はホームの要約だけを出し、そう書く', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_ongoing));
    login();
    renderDashboard();
    const nn = await screen.findByTestId('dashboard-nownext');
    expect(nn).toHaveTextContent('美術館');
    expect(nn).toHaveTextContent('06:38');
    expect(nn).toHaveTextContent('あと1時間59分');
    expect(screen.getByTestId('dashboard-hero')).toHaveAttribute('data-phase', 'ongoing');
    expect(await screen.findByText(/ホームの要約だけを出しています/)).toBeInTheDocument();
  });

  it('[HomeLive] 旅行中は「次の旅まで」ではなく「旅行中 ・ 何日目」。次にすること・案内・チケット(予約がある時だけ)・今日の流れ', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_ongoing));
    const now = Date.now();
    const iso = (min: number) => new Date(now + min * 60_000).toISOString();
    const ev = (id: string, title: string, start: number, extra: Record<string, unknown> = {}) => ({
      id, title, event_type: 'sightseeing', start_at: iso(start), end_at: iso(start + 50), local_start_time: null, address: null,
      latitude: null, longitude: null, has_ticket: false, reservation_id: null, time_source: 'start_at', departure_at: null,
      transport_mode: null, transport_status: null, ...extra,
    });
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now));
    getToday.mockResolvedValue({
      plan_id: 'bd054cef-4cd9-4698-9839-c9befc8659fa', today_date: todayIso, timezone_id: 'Asia/Tokyo',
      server_time: new Date(now).toISOString(), now_event: null, next_event: null, minutes_until_next: null, day_end_at: null,
      events: [
        ev('e1', '朝の神社', -120),
        ev('e2', '寺の拝観', -10),
        ev('e3', '特急で移動', 40, { has_ticket: true, reservation_id: 'r-9', address: '京都駅', transport_status: 'delayed' }),
      ],
    });
    login();
    renderDashboard();
    expect(await screen.findByRole('heading', { level: 1, name: '旅行中 ・ 1日目 / 2日' })).toBeInTheDocument();
    expect(screen.queryByText(/次の旅まで/)).toBeNull();
    const nn = await screen.findByTestId('dashboard-nownext');
    await waitFor(() => expect(nn).toHaveTextContent('特急で移動'));
    expect(nn).toHaveTextContent(/あと (39|40) 分/);
    expect(nn).toHaveTextContent('遅延');
    const acts = within(nn).getByRole('navigation', { name: 'この旅行の操作' });
    expect(within(acts).getByRole('link', { name: /案内を開く/ })).toHaveAttribute('href', expect.stringContaining('google.com/maps/search'));
    expect(within(acts).getByRole('link', { name: 'チケット' })).toHaveAttribute('href', '/planner/bd054cef-4cd9-4698-9839-c9befc8659fa/reservations?open=r-9');
    expect(screen.getByTestId('live-now')).toHaveTextContent('寺の拝観');
    const flow = screen.getByTestId('live-flow');
    const items = within(flow).getAllByRole('listitem');
    expect(items.map((li) => li.getAttribute('data-state'))).toEqual(['done', 'now', 'next']);
    fireEvent.click(within(items[2]!).getByRole('button'));
    expect(within(items[2]!).getByRole('button')).toHaveAttribute('aria-pressed', 'true');
    // 遅延・休業の知らせが無い時は短い確認だけ。旅行前の「旅の準備」は出さない
    expect(screen.getByTestId('live-alerts-ok')).toBeInTheDocument();
    expect(screen.queryByTestId('home-progress')).toBeNull();
    // 座標の無い予定だけなら地図は出さず、理由を書く
    expect(screen.getByText('今日の予定に座標が無いため、地図は出せません。')).toBeInTheDocument();
  });

  it('[HomeLive] 次の予定にチケットが無ければ「チケット」を出さない', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_ongoing));
    const now = Date.now();
    const todayIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(now));
    getToday.mockResolvedValue({
      plan_id: 'p', today_date: todayIso, timezone_id: 'Asia/Tokyo', server_time: new Date(now).toISOString(),
      now_event: null, next_event: null, minutes_until_next: null, day_end_at: null,
      events: [{ id: 'x', title: '昼食', event_type: 'meal', start_at: new Date(now + 3_600_000).toISOString(), end_at: null,
        local_start_time: null, address: null, latitude: 35, longitude: 135.7, has_ticket: false, reservation_id: null,
        time_source: 'start_at', departure_at: null, transport_mode: null, transport_status: null }],
    });
    login();
    renderDashboard();
    const nn = await screen.findByTestId('dashboard-nownext');
    await waitFor(() => expect(nn).toHaveTextContent('昼食'));
    expect(within(nn).queryByRole('link', { name: 'チケット' })).toBeNull();
    expect(within(nn).getByRole('link', { name: /案内を開く/ })).toHaveAttribute('href', expect.stringContaining('destination=35%2C135.7'));
  });

  it('旅行後: 精算・記録への案内(準備・遅延は出さない)', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_past));
    login();
    renderDashboard();
    expect(await screen.findByTestId('dashboard-after')).toBeInTheDocument();
    expect(screen.queryByTestId('dashboard-readiness')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /費用を精算する/ })).toBeInTheDocument();
  });

  it('閲覧のみ: 招待の操作を出さず、役割を文字で示す', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_viewer));
    login();
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByRole('link', { name: /一緒に行く人を招く/ })).not.toBeInTheDocument();
    expect(screen.getAllByText(/閲覧のみ/).length).toBeGreaterThan(0);
  });

  it('失敗: 案内と再試行(押すと読み直す)', async () => {
    getDashboard.mockRejectedValueOnce(new Error('boom')).mockResolvedValue(decodeDashboard(fx.dashboard_empty));
    login();
    renderDashboard();
    const err = await screen.findByTestId('dashboard-error');
    expect(err).toHaveAttribute('role', 'alert');
    fireEvent.click(within(err).getByRole('button', { name: 'もう一度読み込む' }));
    expect(await screen.findByTestId('dashboard-hero')).toBeInTheDocument();
    expect(getDashboard).toHaveBeenCalledTimes(2);
  });

  it('オフライン: 案内を出し、つながったら読み直す', async () => {
    setOnline(false);
    getDashboard.mockRejectedValueOnce(new Error('Network Error')).mockResolvedValue(decodeDashboard(fx.dashboard_upcoming));
    login();
    renderDashboard();
    expect(await screen.findByTestId('dashboard-offline')).toHaveTextContent('オフラインです');
    setOnline(true);
    await act(async () => { window.dispatchEvent(new Event('online')); });
    expect(await screen.findByTestId('dashboard-hero')).toBeInTheDocument();
  });

  it('[Gate HeaderPicker] 見た目の選択はホームの見出しに置かない(上の帯の印へ移した)。選んだ見た目には従う', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_empty));
    try { window.localStorage.setItem('tc.theme', 'dark'); } catch { /* 保存できない環境 */ }
    useThemeStore.setState({ preference: 'dark' });
    login();
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    expect(screen.queryByLabelText('表示')).not.toBeInTheDocument();
    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-theme', 'dark');
    act(() => { useThemeStore.setState({ preference: 'system' }); });
    try { window.localStorage.removeItem('tc.theme'); } catch { /* 保存できない環境 */ }
  });
});
