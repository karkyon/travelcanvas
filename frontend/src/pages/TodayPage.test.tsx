/**
 * [Gate L1b] TodayPage: 日程タイムゾーンでの表示・遅延表示・オフライン表示。
 * 応答は実backendから採取したfixture(京都、Asia/Tokyo、NEXTへ向かう経路が遅延)。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { TodayResponse } from '@/services/api';

const { getToday, getOfflinePackKey } = vi.hoisted(() => ({
  getToday: vi.fn(),
  getOfflinePackKey: vi.fn(async () => ({
    user_id: 'user-today', key_version: 1, key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
    algorithm: 'AES-256-GCM', key_bits: 256, issued_at: '2026-05-01T00:00:00Z',
  })),
}));
vi.mock('@/services/api', () => ({
  getToday, getOfflinePackKey,
  travelAPI: { getPlan: vi.fn(async () => ({ success: true, data: { id: 'plan-l1b', title: '京都の旅', destination: '京都' } })) },
}));
// [Gate K1] 当日画面の保存は利用者ごとの鍵で暗号化する(offlineVault)
const SESSION = { userId: 'user-today', sessionTag: 'login-1', legacyToken: null };
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => SESSION }));
vi.mock('./today/TodaySwitchPanel', () => ({ default: () => null }));
// [Gate TDay] 当日の地図(Leaflet・後から読む)はこの試験の対象外
vi.mock('./today/live/TodayMap', () => ({ default: () => null }));

import TodayPage from './TodayPage';
import { saveTodayCache } from './today/todayModel';
import { clearSnapshots } from '@/utils/offlineVault';

const data = fx.today_with_transport as TodayResponse;
const PLAN = 'plan-l1b';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={[`/planner/${PLAN}/today`]}>
      <Routes>
        <Route path="/planner/:planId/today" element={<TodayPage />} />
      </Routes>
    </MemoryRouter>
  );

// [Gate G10-UX] UX-5 NOW・NEXT は見出しつきの区切り(section)。試験は区切りの testid で探す
const card = (label: string) => screen.getByTestId(label === 'NOW' ? 'today-now' : 'today-next');

describe('TodayPage (Gate L1b)', () => {
  beforeEach(async () => {
    await clearSnapshots();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(data.server_time));
    window.localStorage.clear();
    getToday.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  const deviceZone = (timeZone: string) => {
    const original = Intl.DateTimeFormat.prototype.resolvedOptions;
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (
      this: Intl.DateTimeFormat
    ) {
      return { ...original.call(this), timeZone };
    });
  };

  it('時刻を日程の現地時間で表示し、NEXTへ向かう経路の遅延と出発までを出す', async () => {
    deviceZone('America/New_York'); // 端末は旅行先と別のタイムゾーン
    getToday.mockResolvedValue(data);
    renderPage();

    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');
    const now = card('NOW');
    expect(within(now).getByText('ホテル')).toBeInTheDocument();
    // [Gate TDay-Mock] NOW は現地の時刻の範囲(終わりは次の予定の開始)
    expect(now).toHaveTextContent('いま 08:00');

    // NEXT は「出発の合図」: 出る時刻(経路の出発 12:10)・着く時刻(15:00)・遅延を文字で
    const next = card('NEXT');
    expect(next).toHaveTextContent('京都駅 15:00着');
    expect(within(next).getByText('遅延')).toBeInTheDocument();
    expect(within(next).getByText('12:10 に出発')).toBeInTheDocument();
    expect(screen.getByTestId('today-live-band')).toHaveTextContent('あと70分で出発');
    expect(screen.getByText(/時刻は現地時間\(Asia\/Tokyo\)/)).toBeInTheDocument();
    expect(screen.queryByText(/保存した情報を表示中/)).not.toBeInTheDocument();
  });

  it('端末と日程のタイムゾーンが同じなら現地時間の注記は出さない', async () => {
    deviceZone('Asia/Tokyo');
    getToday.mockResolvedValue(data);
    renderPage();
    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');
    expect(screen.getByText(/5\/1（金）/)).toBeInTheDocument();
    expect(screen.queryByText(/時刻は現地時間/)).not.toBeInTheDocument();
  });

  it('通信できない場合は端末に保存した当日情報から現在時刻のNOW/NEXTを出し、最終取得時刻を明示する', async () => {
    // 11:00 JSTに取得・保存 → 15:30 JST(京都駅の予定中)にオフラインで開く
    expect(await saveTodayCache(SESSION, PLAN, data, 0)).toBe(true);
    vi.setSystemTime(new Date('2026-05-01T06:30:00Z'));
    getToday.mockRejectedValue(new Error('Network Error'));
    renderPage();

    const banner = await screen.findByText(/に保存した情報を表示中/);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(banner.closest('[role="status"]')).toHaveTextContent('11:00 に保存した情報を表示中');
    expect(screen.getByTestId('today-offline')).toHaveTextContent('通信なしで使えるもの');
    expect(within(card('NOW')).getByText('京都駅')).toBeInTheDocument();
    expect(screen.getByText('本日、これ以降の予定はありません')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('表示中に取得が失敗しても表示を消さず、保存済み表示であることを示す', async () => {
    getToday.mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');

    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByText(/に保存した情報を表示中/)).toBeInTheDocument();
    expect(card('NEXT')).toHaveTextContent('京都駅');
  });

  it('保存済みの当日情報が別の日のものならNOW/NEXTを出さない', async () => {
    expect(await saveTodayCache(SESSION, PLAN, data, 0)).toBe(true);
    vi.setSystemTime(new Date('2026-05-02T01:00:00Z'));
    getToday.mockRejectedValue(new Error('Network Error'));
    renderPage();

    expect(await screen.findByText(/保存済みの当日情報は2026-05-01のものです/)).toBeInTheDocument();
    expect(screen.queryByText('NOW')).not.toBeInTheDocument();
  });

  it('保存済みの情報も無ければエラーを表示する', async () => {
    getToday.mockRejectedValue({ response: { data: { detail: 'このプランへのアクセス権がありません' } } });
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('このプランへのアクセス権がありません');
  });
});

// [Gate G10-UX] UX-5 この後の予定・簡易表示・つながりの状態・今の予定の進み
describe('TodayPage の流れ (Gate G10-UX UX-5)', () => {
  const base = data;
  const later = { ...base.events[1]!, id: 'later-1', title: '祇園', start_at: '2026-05-01T09:00:00Z', end_at: null,
    transport_status: null, departure_at: null, has_ticket: true, reservation_id: 'r-1' };
  const withLater = { ...base, events: [...base.events, later] } as TodayResponse;

  beforeEach(async () => {
    await clearSnapshots();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(base.server_time));
    window.localStorage.clear();
    getToday.mockReset();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('今日の旅程に今日の予定を全て出し、NOW・NEXT を文字で示す。簡易表示では今と次だけ(端末に覚える)', async () => {
    getToday.mockResolvedValue(withLater);
    const first = renderPage();
    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');
    expect(await screen.findByRole('heading', { name: '京都の旅' })).toBeInTheDocument();
    expect(screen.getByTestId('today-sync')).toHaveTextContent('最新');
    // [Gate TDay-Mock] 今日の旅程は下の「当日の画面」の「旅程」で開く(戻るで閉じる)
    fireEvent.click(within(screen.getByRole('navigation', { name: '当日の画面' })).getByRole('button', { name: '旅程' }));
    const list = await screen.findByRole('list', { name: '今日の旅程' });
    expect(within(list).getByText('祇園')).toBeInTheDocument();
    expect(within(list).getByText('京都駅').closest('li')).toHaveAttribute('data-state', 'NEXT');
    expect(within(list).getByText('ホテル').closest('li')).toHaveAttribute('data-state', 'NOW');
    expect(within(list).getByText('チケット')).toBeInTheDocument();
    expect(screen.getByTestId('today-summary')).toHaveTextContent('この後 2件');
    expect(screen.getByTestId('today-summary')).toHaveTextContent('時刻は現地時間（Asia/Tokyo）');
    fireEvent.click(screen.getByRole('button', { name: '今日へ戻る' }));
    await waitFor(() => expect(screen.queryByRole('list', { name: '今日の旅程' })).toBeNull());

    const toggle = screen.getByRole('button', { name: '簡易表示' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.queryByRole('navigation', { name: '当日の画面' })).toBeNull();
    expect(screen.getAllByRole('button', { name: '簡易表示: 入' })[0]).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('today-now')).toHaveTextContent('いま');
    expect(screen.getByTestId('today-next')).toHaveTextContent('つぎ');
    expect(window.localStorage.getItem('tc.today.simple')).toBe('1');
    first.unmount();

    renderPage();
    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');
    expect(screen.getByTestId('today-now')).toHaveTextContent('いま');
    expect(screen.queryByRole('navigation', { name: '当日の画面' })).toBeNull();
  });

  it('NOW の残りの時間と進み(終わりは次の予定の開始)を、数値つきの進みの棒で出す', async () => {
    getToday.mockResolvedValue(base);
    renderPage();
    const now = await screen.findByTestId('today-now');
    const bar = within(now).getByRole('progressbar', { name: '今の予定の進み' });
    // ホテル 08:00(JST)開始・次の京都駅 15:00 まで、今 11:00 → 残り 240分・3/7
    expect(within(now).getAllByText('残り 240分').length).toBeGreaterThan(0);
    expect(bar).toHaveAttribute('aria-valuenow', '43');
  });

  it('保存済みの表示の時は、つながりの状態を「保存済み」と文字で示す。当日の操作は画面の下にまとめる', async () => {
    getToday.mockResolvedValueOnce(base);
    renderPage();
    expect(await screen.findByTestId('today-now')).toHaveTextContent('ホテル');
    getToday.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByText(/に保存した情報を表示中/)).toBeInTheDocument();
    expect(screen.getByTestId('today-sync')).toHaveTextContent('保存済み');
    // [Gate TDay-Mock] 当日の操作(写真・ひとこと / お助け / チケット)は画面の下にまとめる
    const nav = screen.getByRole('navigation', { name: '当日の操作' });
    expect(within(nav).getByRole('button', { name: /写真・ひとこと/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'お助け' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: /チケット/ })).toBeInTheDocument();
  });
});
