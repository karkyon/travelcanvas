/**
 * [Gate G9] UX-3 全体の見出し: 高さを固定(h-16)・項目名を折り返さない・「AI検索」は1か所・今開いている旅行を示す・
 * 通知の未読数を読み上げる・メニューの開閉を aria-expanded で伝える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const { getUnreadCount, getPlans, getPlan } = vi.hoisted(() => ({ getUnreadCount: vi.fn(), getPlans: vi.fn(), getPlan: vi.fn() }));
vi.mock('../services/api', async (orig) => ({
  ...(await orig<typeof import('../services/api')>()),
  notificationsAPI: { getUnreadCount },
  travelAPI: { getPlans, getPlan },
}));
vi.mock('./CommandPaletteLauncher', () => ({ default: () => <button type="button">検索(Ctrl+K)</button> }));

import Header from './Header';
import { useAuthStore } from '../store/authStore';
import { useCurrentTripStore } from '../store/currentTripStore';
import type { User } from '../types';
import { useThemeStore } from '../hooks/useThemePreference';

const PLAN = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';

const renderAt = async (path: string) => {
  const r = render(<MemoryRouter initialEntries={[path]}><Header /></MemoryRouter>);
  await screen.findByRole('link', { name: '通知(未読 3件)' }); // 未読数の取得を待つ(act の外での更新を残さない)
  return r;
};

describe('Header (Gate G9 UX-3)', () => {
  beforeEach(() => {
    getUnreadCount.mockReset().mockResolvedValue({ data: { unread_count: 3 } });
    getPlans.mockReset().mockResolvedValue({
      success: true, data: [
        { id: OTHER, title: '金沢と能登', destination: '金沢', start_date: '2027-04-01', end_date: '2027-04-04', days: [] },
        { id: PLAN, title: '京都 紅葉の1泊2日', destination: '京都', start_date: '2026-11-14', end_date: '2026-11-15', days: [] },
      ],
    });
    getPlan.mockReset().mockResolvedValue({ success: true, data: { id: OTHER, title: '金沢と能登', start_date: '2027-04-01', end_date: '2027-04-04', days: [] } });
    // 会員のトークンも入れておく。authStore は読み込み時に setTimeout(0) で initialize() を予約しており、
    // トークンの無い会員だと「再読込の後」とみなして /auth/refresh を本当に呼んでしまう(実行順で結果が変わる原因)。
    useAuthStore.setState({
      isAuthenticated: true, isGuest: false, token: 'test-access-token', isInitialized: true,
      user: { id: 'u-1', username: 'alice', email: 'a@example.com', user_type: 'standard' } as unknown as User,
    });
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都 紅葉の1泊2日' } });
  });

  it('[Gate AppShell] 上の帯は高さが一定(72px の行)。画面の移動は左の帯へ移し、上の帯には置かない', async () => {
    await renderAt('/dashboard');
    const header = screen.getByTestId('global-header');
    expect(header.querySelector('.tc-topbar-row')).not.toBeNull();
    expect(within(header).queryByRole('navigation', { name: '主なメニュー' })).not.toBeInTheDocument();
    expect(header.querySelector('.animate-pulse')).toBeNull();
    expect(screen.queryByTestId('header-current-trip')).not.toBeInTheDocument();
    // [Gate HeaderPicker] 旅行の外では「旅行を選ぶ」。押しても画面は移らず、旅行の一覧を出す
    expect(screen.getByTestId('header-trip-picker').tagName).toBe('BUTTON');
  });

  it('[Gate HeaderPicker] 「旅行を選ぶ」は一覧を開き(画面を移らない)、選んだ旅行の旅程へ移る', async () => {
    await renderAt('/dashboard');
    const picker = screen.getByTestId('header-trip-picker');
    expect(picker).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(picker);
    expect(picker).toHaveAttribute('aria-expanded', 'true');
    const menu = await screen.findByTestId('trip-picker-menu');
    const items = await within(menu).findAllByRole('button');
    // 出発の早い順
    expect(items.map((b) => b.textContent)).toEqual([expect.stringContaining('京都 紅葉の1泊2日'), expect.stringContaining('金沢と能登')]);
    expect(within(menu).getByRole('link', { name: '旅行の一覧へ' })).toHaveAttribute('href', '/planner');
    fireEvent.click(within(menu).getByTestId(`trip-picker-item-${OTHER}`));
    await waitFor(() => expect(screen.queryByTestId('trip-picker-menu')).not.toBeInTheDocument());
  });

  it('旅行の中では今開いている旅行を示す', async () => {
    await renderAt(`/planner/${PLAN}/today`);
    expect(screen.getByTestId('header-current-trip')).toHaveTextContent('京都 紅葉の1泊2日');
    // [Gate HeaderPicker] 押すと旅行を切り替える一覧を出す(今の旅行に印)
    fireEvent.click(screen.getByTestId('header-current-trip'));
    const menu = await screen.findByTestId('trip-picker-menu');
    expect(await within(menu).findByTestId(`trip-picker-item-${PLAN}`)).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByTestId('header-trip-picker')).not.toBeInTheDocument();
    // この旅行のメニューを旅行の名前の右に並べる
    expect(await screen.findByTestId('trip-nav')).toBeInTheDocument();
  });

  it('[Gate HeaderPicker] 旅程を経ずに別の旅行の画面(費用など)を開いても、その旅行を読んで名前を出す', async () => {
    await renderAt(`/planner/${OTHER}/expenses`);
    await waitFor(() => expect(screen.getByTestId('header-current-trip')).toHaveTextContent('金沢と能登'));
    expect(getPlan).toHaveBeenCalledWith(OTHER);
  });

  it('[Gate TripShare] 「共有」の画面(/share/<id>)でも今の旅行の名前を出し、「旅行を選ぶ」に戻らない', async () => {
    await renderAt(`/share/${PLAN}`);
    expect(screen.getByTestId('header-current-trip')).toHaveTextContent('京都 紅葉の1泊2日');
    expect(screen.queryByTestId('header-trip-picker')).not.toBeInTheDocument();
    expect(await screen.findByTestId('rail-share')).toHaveAttribute('aria-current', 'page');
  });

  it('[Gate TripShare] 共有の画面を直接開いた時も、その旅行を読んで名前を出す', async () => {
    await renderAt(`/share/${OTHER}`);
    await waitFor(() => expect(screen.getByTestId('header-current-trip')).toHaveTextContent('金沢と能登'));
    expect(getPlan).toHaveBeenCalledWith(OTHER);
  });

  it('旅行を読めない時は名前を作らない(「旅行を選ぶ」のまま)', async () => {
    getPlan.mockRejectedValue(new Error('403'));
    await renderAt(`/planner/${OTHER}`);
    await waitFor(() => expect(getPlan).toHaveBeenCalled());
    expect(screen.queryByTestId('header-current-trip')).not.toBeInTheDocument();
    expect(screen.getByTestId('header-trip-picker')).toBeInTheDocument();
  });

  it('通知の未読数を名前で伝え、メニューの開閉を aria-expanded で伝える', async () => {
    await renderAt('/dashboard');
    const userBtn = screen.getByRole('button', { name: /^alice/ });
    expect(userBtn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(userBtn);
    expect(userBtn).toHaveAttribute('aria-expanded', 'true');
    // [Gate AppShell] メニューは開いた時に読み込む
    expect(await screen.findByRole('link', { name: '設定' })).toBeInTheDocument();
    const menuBtn = screen.getByRole('button', { name: 'メニューを開く' });
    fireEvent.click(menuBtn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'メニューを閉じる' })).toHaveAttribute('aria-expanded', 'true'));
    // スマホのメニューは左の帯と同じ全ての項目を出す
    const mobile = await screen.findByRole('navigation', { name: '主なメニュー(スマホ)' });
    // [Gate HomeV2] モックアップ v2 の項目(旅行を開いていない時は、旅行の中の項目を出さない)
    for (const name of ['ホーム', '旅行', '旅の記録と思い出', '行きたい場所', '発見', '旅行相談', '設定']) {
      expect(within(mobile).getByRole('link', { name })).toBeInTheDocument();
    }
  });

  it('[Gate HeaderPicker] 見た目(端末に合わせる・明るい・暗い)は上の帯の印から選び、選んだものを aria-checked で示す', async () => {
    useThemeStore.setState({ preference: 'system' });
    await renderAt('/dashboard');
    const toggle = await screen.findByTestId('theme-toggle');
    expect(toggle).toHaveAccessibleName('表示: 端末に合わせる(変える)');
    fireEvent.click(toggle);
    const group = screen.getByRole('radiogroup', { name: '表示' });
    expect(within(group).getByRole('radio', { name: '端末に合わせる' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(group).getByRole('radio', { name: '暗い' }));
    expect(useThemeStore.getState().preference).toBe('dark');
    expect(window.localStorage.getItem('tc.theme')).toBe('dark');
    expect(screen.getByTestId('theme-toggle')).toHaveAccessibleName('表示: 暗い(変える)');
    fireEvent.click(screen.getByTestId('theme-toggle'));
    fireEvent.click(screen.getByRole('radio', { name: '端末に合わせる' }));
    expect(window.localStorage.getItem('tc.theme')).toBeNull();
    // ユーザーのメニューには重ねて置かない
    fireEvent.click(screen.getByRole('button', { name: /^alice/ }));
    await screen.findByRole('link', { name: '設定' });
    expect(screen.queryByRole('group', { name: '表示' })).not.toBeInTheDocument();
  });
});
