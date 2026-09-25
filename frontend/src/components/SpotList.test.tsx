/**
 * [Gate M9-FE-B3] SpotListの読込effectの発火回数を固定する回帰テスト。
 * loadSpotsをuseCallback化し依存を正しく宣言した後も、発火条件は
 * 「マウント時・カテゴリ変更時・refreshTrigger変更時」のみであること、
 * および読込失敗toastで再読込ループが起きないことを確認する。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const { getSpots, getCategories, getFavorites, getVisits } = vi.hoisted(() => ({
  getSpots: vi.fn(),
  getCategories: vi.fn(),
  getFavorites: vi.fn(),
  getVisits: vi.fn(),
}));

vi.mock('../services/spotApi', () => ({
  spotApiService: { getSpots, getCategories, getFavorites, getVisits },
}));

import SpotList from './SpotList';
import { ToastProvider } from './common/Toast';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('SpotList (Gate M9-FE-B3)', () => {
  beforeEach(() => {
    getSpots.mockReset();
    getCategories.mockReset().mockResolvedValue({ categories: [] });
    getFavorites.mockReset().mockResolvedValue([]);
    getVisits.mockReset().mockResolvedValue([]);
  });

  it('マウント時に1回、refreshTrigger変更時にのみ再読込する', async () => {
    getSpots.mockResolvedValue([]);
    const { rerender } = render(
      <ToastProvider>
        <SpotList refreshTrigger={0} />
      </ToastProvider>
    );
    await waitFor(() => expect(getSpots).toHaveBeenCalledTimes(1));
    expect(getSpots).toHaveBeenLastCalledWith('all');

    // 同じpropsでの再描画では再読込しない
    rerender(
      <ToastProvider>
        <SpotList refreshTrigger={0} />
      </ToastProvider>
    );
    await sleep(30);
    expect(getSpots).toHaveBeenCalledTimes(1);

    rerender(
      <ToastProvider>
        <SpotList refreshTrigger={1} />
      </ToastProvider>
    );
    await waitFor(() => expect(getSpots).toHaveBeenCalledTimes(2));
    await sleep(30);
    expect(getSpots).toHaveBeenCalledTimes(2);
  });

  it('読込失敗でエラーtoastを出しても、再読込ループは起きない', async () => {
    getSpots.mockRejectedValue(new Error('boom'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    render(
      <ToastProvider>
        <SpotList />
      </ToastProvider>
    );
    expect(await screen.findByText('スポットの読み込みに失敗しました')).toBeInTheDocument();
    await sleep(80);
    expect(getSpots).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});
