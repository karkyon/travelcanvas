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

const { getDashboard } = vi.hoisted(() => ({ getDashboard: vi.fn() }));
vi.mock('../services/api/g9', () => ({ getDashboard }));

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

const login = () => useAuthStore.setState({
  isAuthenticated: true, isGuest: false,
  user: { id: 'u-1', username: 'alice', email: 'a@example.com' } as unknown as User,
});

const setOnline = (v: boolean) => Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => v });

describe('DashboardPage', () => {
  beforeEach(() => {
    getDashboard.mockReset();
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

  it('旅行中: NOW/NEXT(現地の時刻・残り時間)', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_ongoing));
    login();
    renderDashboard();
    const nn = await screen.findByTestId('dashboard-nownext');
    expect(nn).toHaveTextContent('美術館');
    expect(nn).toHaveTextContent('06:38');
    expect(nn).toHaveTextContent('あと1時間59分');
    expect(screen.getByTestId('dashboard-hero')).toHaveAttribute('data-phase', 'ongoing');
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

  it('暗い見た目を選べる(この端末に保存)', async () => {
    getDashboard.mockResolvedValue(decodeDashboard(fx.dashboard_empty));
    login();
    renderDashboard();
    await screen.findByTestId('dashboard-hero');
    fireEvent.change(screen.getByLabelText('表示'), { target: { value: 'dark' } });
    expect(screen.getByTestId('dashboard')).toHaveAttribute('data-theme', 'dark');
    expect(window.localStorage.getItem('tc.theme')).toBe('dark');
  });
});
