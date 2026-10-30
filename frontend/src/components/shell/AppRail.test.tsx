/**
 * [Gate AppShell] 左の帯(UI/UX モックの rail): 10 項目+設定、今の画面の印、旅行の中の項目は今の旅行へ。
 * 旅行を開いていない時は旅程の一覧へ移り、そのことを名前で伝える(押しても何も起きない項目を作らない)。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import AppRail from './AppRail';
import { useCurrentTripStore } from '../../store/currentTripStore';

const PLAN = '11111111-2222-3333-4444-555555555555';
const at = (path: string) => render(<MemoryRouter initialEntries={[path]}><AppRail /></MemoryRouter>);
const NAMES = ['ホーム', '旅程', '発見', '今日', '旅行箱', '共有', '記録', '旅行相談', 'クイック', '比較', '設定'];

describe('AppRail', () => {
  beforeEach(() => useCurrentTripStore.setState({ trip: null }));

  it('モックと同じ順の 11 項目。ホームで「ホーム」を今の画面にする', () => {
    at('/dashboard');
    const nav = screen.getByRole('navigation', { name: '主なメニュー' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.textContent?.replace('(旅行を選ぶと開きます)', ''))).toEqual(NAMES);
    expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'ホーム' })).toHaveAttribute('href', '/dashboard');
  });

  it('旅行を開いていない時: 旅行の中の項目は一覧へ移り、旅行を選ぶよう伝える', () => {
    at('/dashboard');
    const today = screen.getByTestId('rail-today');
    expect(today).toHaveAttribute('href', '/planner');
    expect(today).toHaveAccessibleName('今日 (旅行を選ぶと開きます)');
    expect(screen.getByTestId('rail-discover')).toHaveAttribute('href', '/search');
    expect(screen.getByTestId('rail-quick')).toHaveAttribute('href', '/planner?new=1');
  });

  it('旅行の中: 今の旅行の各画面へ移り、今の画面に印を付ける', () => {
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都' } });
    at(`/planner/${PLAN}/reservations`);
    expect(screen.getByTestId('rail-plan')).toHaveAttribute('href', `/planner/${PLAN}`);
    expect(screen.getByTestId('rail-today')).toHaveAttribute('href', `/planner/${PLAN}/today`);
    expect(screen.getByTestId('rail-resources')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('rail-share')).toHaveAttribute('href', `/share/${PLAN}`);
    expect(screen.getByTestId('rail-memory')).toHaveAttribute('href', `/planner/${PLAN}/memories`);
    expect(screen.getByTestId('rail-optimize')).toHaveAttribute('href', `/planner/${PLAN}/route-options`);
    expect(screen.getByTestId('rail-discover')).toHaveAttribute('href', `/planner/${PLAN}/candidates`);
    expect(screen.getByTestId('rail-today')).toHaveAccessibleName('今日');
  });

  it('旅程の画面では「旅程」に印を付ける', () => {
    useCurrentTripStore.setState({ trip: { id: PLAN, title: '京都' } });
    at(`/planner/${PLAN}`);
    expect(screen.getByTestId('rail-plan')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('rail-home')).not.toHaveAttribute('aria-current');
  });
});
