/**
 * [Gate L1b] TodayPage: 日程タイムゾーンでの表示・遅延表示・オフライン表示。
 * 応答は実backendから採取したfixture(京都、Asia/Tokyo、NEXTへ向かう経路が遅延)。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
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
vi.mock('@/services/api', () => ({ getToday, getOfflinePackKey }));
// [Gate K1] 当日画面の保存は利用者ごとの鍵で暗号化する(offlineVault)
const SESSION = { userId: 'user-today', sessionTag: 'login-1', legacyToken: null };
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => SESSION }));

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

    expect(await screen.findByText('ホテル')).toBeInTheDocument();
    const now = card('NOW');
    expect(within(now).getByText('ホテル')).toBeInTheDocument();
    expect(within(now).getByText('08:00')).toBeInTheDocument();

    const next = card('NEXT');
    expect(within(next).getByText('京都駅')).toBeInTheDocument();
    expect(within(next).getByText('15:00 〜 16:00')).toBeInTheDocument();
    expect(within(next).getByText('遅延')).toBeInTheDocument();
    expect(within(next).getByText('出発 12:10')).toBeInTheDocument();
    expect(within(next).getByText('出発 1時間10分後')).toBeInTheDocument();
    expect(screen.getByText(/時刻は現地時間\(Asia\/Tokyo\)/)).toBeInTheDocument();
    expect(screen.queryByText(/保存済みの情報/)).not.toBeInTheDocument();
  });

  it('端末と日程のタイムゾーンが同じなら現地時間の注記は出さない', async () => {
    deviceZone('Asia/Tokyo');
    getToday.mockResolvedValue(data);
    renderPage();
    expect(await screen.findByText('ホテル')).toBeInTheDocument();
    expect(screen.getByText('2026-05-01')).toBeInTheDocument();
    expect(screen.queryByText(/時刻は現地時間/)).not.toBeInTheDocument();
  });

  it('通信できない場合は端末に保存した当日情報から現在時刻のNOW/NEXTを出し、最終取得時刻を明示する', async () => {
    // 11:00 JSTに取得・保存 → 15:30 JST(京都駅の予定中)にオフラインで開く
    expect(await saveTodayCache(SESSION, PLAN, data, 0)).toBe(true);
    vi.setSystemTime(new Date('2026-05-01T06:30:00Z'));
    getToday.mockRejectedValue(new Error('Network Error'));
    renderPage();

    const banner = await screen.findByText(/保存済みの情報を表示しています/);
    expect(banner.closest('[role="status"]')).not.toBeNull();
    expect(banner).toHaveTextContent('最終取得 11:00');
    expect(within(card('NOW')).getByText('京都駅')).toBeInTheDocument();
    expect(screen.getByText('本日、これ以降の予定はありません')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('表示中に取得が失敗しても表示を消さず、保存済み表示であることを示す', async () => {
    getToday.mockResolvedValueOnce(data).mockRejectedValueOnce(new Error('Network Error'));
    renderPage();
    expect(await screen.findByText('ホテル')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByText(/保存済みの情報を表示しています/)).toBeInTheDocument();
    expect(screen.getByText('京都駅')).toBeInTheDocument();
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

  it('NEXT の後の予定を出し、NOW・NEXT は一覧に重ねない。簡易表示では今と次だけ(端末に覚える)', async () => {
    getToday.mockResolvedValue(withLater);
    const first = renderPage();
    expect(await screen.findByText('ホテル')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'この後の予定' });
    expect(within(list).getByText('祇園')).toBeInTheDocument();
    expect(within(list).queryByText('京都駅')).toBeNull();
    expect(within(list).getByText('チケット')).toBeInTheDocument();
    expect(screen.getByTestId('today-summary')).toHaveTextContent('この後 1件');
    expect(screen.getByTestId('today-sync')).toHaveTextContent('最新');

    const toggle = screen.getByRole('button', { name: '簡易表示' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(screen.queryByRole('list', { name: 'この後の予定' })).toBeNull();
    expect(screen.getByRole('button', { name: '簡易表示: 入' })).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('tc.today.simple')).toBe('1');
    first.unmount();

    renderPage();
    expect(await screen.findByText('ホテル')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'この後の予定' })).toBeNull();
  });

  it('NOW の残りの時間と進み(終わりは次の予定の開始)を、数値つきの進みの棒で出す', async () => {
    getToday.mockResolvedValue(base);
    renderPage();
    const now = await screen.findByTestId('today-now');
    const bar = within(now).getByRole('progressbar', { name: '今の予定の進み' });
    // ホテル 08:00(JST)開始・次の京都駅 15:00 まで、今 11:00 → 残り 240分・3/7
    expect(within(now).getByText('残り 240分')).toBeInTheDocument();
    expect(bar).toHaveAttribute('aria-valuenow', '43');
  });

  it('保存済みの表示の時は、つながりの状態を「保存済み」と文字で示す。当日の操作は画面の下にまとめる', async () => {
    getToday.mockResolvedValueOnce(base);
    renderPage();
    expect(await screen.findByText('ホテル')).toBeInTheDocument();
    getToday.mockRejectedValueOnce(new Error('offline'));
    fireEvent.click(screen.getByRole('button', { name: '更新' }));
    expect(await screen.findByText(/保存済みの情報を表示しています/)).toBeInTheDocument();
    expect(screen.getByTestId('today-sync')).toHaveTextContent('保存済み');
    const nav = screen.getByRole('navigation', { name: '当日の操作' });
    expect(within(nav).getByRole('button', { name: /遅延・休業などの対応/ })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'プランへ' })).toBeInTheDocument();
  });
});
