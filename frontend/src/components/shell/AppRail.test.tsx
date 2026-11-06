/**
 * [Gate AppShell] 左の帯(UI/UX モックの rail): 10 項目+設定、今の画面の印、旅行の中の項目は今の旅行へ。
 * 旅行を開いていない時は旅程の一覧へ移り、そのことを名前で伝える(押しても何も起きない項目を作らない)。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
const { getPlan } = vi.hoisted(() => ({ getPlan: vi.fn() }));
vi.mock('../../services/api', async (orig) => ({
  ...(await orig<typeof import('../../services/api')>()),
  travelAPI: { getPlan },
}));

import AppRail from './AppRail';
import TripNav from './TripNav';
import { useCurrentTripStore } from '../../store/currentTripStore';

const PLAN = '11111111-2222-3333-4444-555555555555';
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><AppRail /></MemoryRouter>);
const NAMES = ['ホーム', '旅行', '旅の記録と思い出', '行きたい場所', '発見', '旅行相談', '設定'];

describe('AppRail', () => {
  beforeEach(() => useCurrentTripStore.setState({ trip: null }));

  it('[HomeV2] モックアップ v2 の順(ホーム・旅行・旅の記録と思い出・行きたい場所・発見・旅行相談)。ホームで「ホーム」を今の画面にする', () => {
    at('/dashboard');
    const nav = screen.getByRole('navigation', { name: '主なメニュー' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent?.replace('(旅行を選ぶと開きます)', ''))).toEqual(NAMES);
    expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/dashboard');
  });

  it('旅行を開いていない時: 旅行の中の項目は出さない。旅行・記録・行きたい場所・発見はそれぞれの一覧へ', () => {
    at('/dashboard');
    expect(screen.queryByTestId('rail-today')).toBeNull();
    expect(screen.getByTestId('rail-trips')).toHaveAttribute('href', '/planner');
    expect(screen.getByTestId('rail-memory')).toHaveAttribute('href', '/memories');
    expect(screen.getByTestId('rail-wish')).toHaveAttribute('href', '/spots');
    expect(screen.getByTestId('rail-discover')).toHaveAttribute('href', '/search');
  });

  it('[TripNav] 旅行の中でも左の帯は共通の項目だけ。旅行の項目は上の帯へ', () => {
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都' } });
    at(`/planner/${PLAN}/reservations`);
    const nav = screen.getByRole('navigation', { name: '主なメニュー' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(NAMES);
    expect(screen.getByTestId('rail-discover')).toHaveAttribute('href', `/planner/${PLAN}/candidates`);
  });

  it('[TripNav] この旅行のメニューは今の旅行へ移り、今の画面に印を付ける', () => {
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都' } });
    render(<MemoryRouter><TripNav tripId={PLAN} path={`/planner/${PLAN}/reservations`} /></MemoryRouter>);
    const nav = screen.getByRole('navigation', { name: 'この旅行のメニュー' });
    expect(within(nav).getAllByRole('link').map((l) => l.textContent)).toEqual(['旅程', '今日', '旅行箱', '共有', '比較']);
    expect(screen.getByTestId('rail-plan')).toHaveAttribute('href', `/planner/${PLAN}`);
    expect(screen.getByTestId('rail-resources')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('rail-share')).toHaveAttribute('href', `/share/${PLAN}`);
  });

  it('[HeaderPicker] 旅程を経ずに旅行の中の画面を開いた時は、その旅行を読んで上の帯へ名前を渡す(既に分かっていれば読まない)', async () => {
    getPlan.mockReset().mockResolvedValue({ success: true, data: { id: PLAN, title: '京都 紅葉', start_date: '2026-11-14', days: [] } });
    render(<MemoryRouter><TripNav tripId={PLAN} path={`/planner/${PLAN}/expenses`} /></MemoryRouter>);
    await waitFor(() => expect(useCurrentTripStore.getState().trip?.title).toBe('京都 紅葉'));
    expect(getPlan).toHaveBeenCalledTimes(1);
  });
});
