/**
 * [Gate M9-FE-B3] DashboardPage: 認証チェックeffectの依存を正しく宣言したことで、
 * 表示中に未認証へ変わった場合もログイン画面へ遷移すること(以前はマウント時の
 * 一度しか判定しておらず遷移しなかった)。統計取得はマウント時1回のまま。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

const { getSpots, getFavorites, getVisits } = vi.hoisted(() => ({
  getSpots: vi.fn(),
  getFavorites: vi.fn(),
  getVisits: vi.fn(),
}));
vi.mock('../services/spotApi', () => ({
  spotApiService: { getSpots, getFavorites, getVisits },
}));

import DashboardPage from './DashboardPage';
import { useAuthStore } from '../store/authStore';
import { usePlanStore } from '../store/planStore';
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

describe('DashboardPage (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    getSpots.mockReset().mockResolvedValue([]);
    getFavorites.mockReset().mockResolvedValue([]);
    getVisits.mockReset().mockResolvedValue([]);
    usePlanStore.setState({ plans: [], loadPlans: vi.fn().mockResolvedValue(undefined) });
  });

  it('未認証ならログイン画面へ遷移する', async () => {
    useAuthStore.setState({ isAuthenticated: false, user: null });
    renderDashboard();
    expect(await screen.findByText('LOGIN-SCREEN')).toBeInTheDocument();
    expect(getSpots).not.toHaveBeenCalled();
  });

  it('表示中に未認証へ変わった場合もログイン画面へ遷移し、統計取得はマウント時の1回だけ', async () => {
    useAuthStore.setState({
      isAuthenticated: true,
      user: { id: 'u-1', username: 'alice', email: 'a@example.com' } as unknown as User,
    });
    renderDashboard();
    await waitFor(() => expect(getSpots).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('LOGIN-SCREEN')).not.toBeInTheDocument();

    act(() => {
      useAuthStore.setState({ isAuthenticated: false, user: null });
    });
    expect(await screen.findByText('LOGIN-SCREEN')).toBeInTheDocument();
    expect(getSpots).toHaveBeenCalledTimes(1);
  });
});
