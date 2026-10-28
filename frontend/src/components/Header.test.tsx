/**
 * [Gate G9] UX-3 全体の見出し: 高さを固定(h-16)・項目名を折り返さない・「AI検索」は1か所・今開いている旅行を示す・
 * 通知の未読数を読み上げる・メニューの開閉を aria-expanded で伝える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getUnreadCount } = vi.hoisted(() => ({ getUnreadCount: vi.fn() }));
vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  notificationsAPI: { getUnreadCount },
}));
vi.mock('./CommandPaletteLauncher', () => ({ default: () => <button type="button">検索(Ctrl+K)</button> }));

import Header from './Header';
import { useAuthStore } from '../store/authStore';
import { useCurrentTripStore } from '../store/currentTripStore';
import type { User } from '../types';

const PLAN = '11111111-2222-3333-4444-555555555555';

const renderAt = async (path: string) => {
  const r = render(<MemoryRouter initialEntries={[path]}><Header /></MemoryRouter>);
  await screen.findByRole('link', { name: '通知(未読 3件)' }); // 未読数の取得を待つ(act の外での更新を残さない)
  return r;
};

describe('Header (Gate G9 UX-3)', () => {
  beforeEach(() => {
    getUnreadCount.mockReset().mockResolvedValue({ data: { unread_count: 3 } });
    // 会員のトークンも入れておく。authStore は読み込み時に setTimeout(0) で initialize() を予約しており、
    // トークンの無い会員だと「再読込の後」とみなして /auth/refresh を本当に呼んでしまう(実行順で結果が変わる原因)。
    useAuthStore.setState({
      isAuthenticated: true, isGuest: false, token: 'test-access-token', isInitialized: true,
      user: { id: 'u-1', username: 'alice', email: 'a@example.com', user_type: 'standard' } as unknown as User,
    });
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都 紅葉の1泊2日' } });
  });

  it('高さは一定・項目名は折り返さない・AI検索は1か所', async () => {
    await renderAt('/dashboard');
    const header = screen.getByTestId('global-header');
    expect(header.querySelector('.h-16')).not.toBeNull();
    const nav = screen.getByRole('navigation', { name: '主なメニュー' });
    for (const link of Array.from(nav.querySelectorAll('a'))) expect(link.className).toContain('whitespace-nowrap');
    expect(screen.getAllByRole('link', { name: /AI検索/ })).toHaveLength(1);
    // jsdom は CSS を当てないため、読み上げ用(sr-only)と見た目用の2つの名前がつながって見える
    expect(within(nav).getByRole('link', { name: /^ダッシュボード/ })).toHaveAttribute('aria-current', 'page');
    expect(header.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('header-current-trip')).not.toBeInTheDocument();
  });

  it('旅行の中では今開いている旅行を示す', async () => {
    await renderAt(`/planner/${PLAN}/today`);
    expect(screen.getByTestId('header-current-trip')).toHaveTextContent('京都 紅葉の1泊2日');
    expect(screen.getByTestId('header-current-trip')).toHaveAttribute('href', `/planner/${PLAN}`);
  });

  it('別の旅行の画面では示さない', async () => {
    await renderAt('/planner/99999999-2222-3333-4444-555555555555');
    expect(screen.queryByTestId('header-current-trip')).not.toBeInTheDocument();
  });

  it('通知の未読数を名前で伝え、メニューの開閉を aria-expanded で伝える', async () => {
    await renderAt('/dashboard');
    const userBtn = screen.getByRole('button', { name: /^alice/ });
    expect(userBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(userBtn);
    expect(userBtn).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('link', { name: '設定' })).toBeInTheDocument();
    const menuBtn = screen.getByRole('button', { name: 'メニューを開く' });
    fireEvent.click(menuBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'メニューを閉じる' })).toHaveAttribute('aria-expanded', 'true'));
  });
});
