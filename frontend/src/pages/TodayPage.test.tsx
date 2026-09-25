/**
 * [Gate L1b] TodayPage: 日程タイムゾーンでの表示・遅延表示・オフライン表示。
 * 応答は実backendから採取したfixture(京都、Asia/Tokyo、NEXTへ向かう経路が遅延)。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { TodayResponse } from '@/services/api';

const { getToday } = vi.hoisted(() => ({ getToday: vi.fn() }));
vi.mock('@/services/api', () => ({ getToday }));

import TodayPage from './TodayPage';
import { saveTodayCache } from './today/todayModel';

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

const card = (label: string) => screen.getByText(label).closest('div.space-y-3') as HTMLElement;

describe('TodayPage (Gate L1b)', () => {
  beforeEach(() => {
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
    saveTodayCache(PLAN, data, 0);
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
    saveTodayCache(PLAN, data, 0);
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
