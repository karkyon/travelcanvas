/**
 * [Gate Honesty] スポット検索の言葉を実際に合わせる(AI・画像の解析・音声の認識は未接続)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { searchSpots } = vi.hoisted(() => ({ searchSpots: vi.fn() }));
vi.mock('../services/api', () => ({ searchSpots }));

import SearchPage from './SearchPage';

const renderPage = () => render(<MemoryRouter><SearchPage /></MemoryRouter>);

describe('SearchPage (Gate Honesty)', () => {
  beforeEach(() => {
    searchSpots.mockReset();
    localStorage.removeItem('search_preferences');
  });

  it('AI の解析を名乗らず、未接続であることを示す', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'スポット検索' })).toBeInTheDocument();
    expect(screen.getByTestId('search-honesty')).toHaveTextContent('未接続');
    expect(document.body.textContent).not.toMatch(/AI(が|で)?(インターネット|画像解析|音声認識|検索エンジン|信頼度|推奨|分析)/);
  });

  it('写真・声は準備中: 送る操作を出さず、言葉で探す方へ戻れる', async () => {
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /写真から探す/ }));
    expect(screen.getByTestId('search-unavailable-image')).toHaveTextContent('準備中');
    expect(document.querySelector('input[type="file"]')).toBeNull();
    await userEvent.click(screen.getByRole('tab', { name: /声で探す/ }));
    expect(screen.getByTestId('search-unavailable-voice')).toHaveTextContent('準備中');
    await userEvent.click(screen.getByRole('button', { name: '言葉で探す' }));
    expect(screen.getByRole('searchbox', { name: '探す言葉' })).toBeInTheDocument();
  });

  it('結果は出典を示し、評価・値段を作らない。0件・失敗は文で伝える', async () => {
    searchSpots.mockResolvedValueOnce({
      success: true,
      data: { spots: [{ id: 'c1', name: '清水寺', description: '', category: 'tourist_attraction', provider: 'wikipedia', location: { address: '京都市東山区' } }] },
    });
    renderPage();
    await userEvent.type(screen.getByRole('searchbox', { name: '探す言葉' }), '清水寺');
    await userEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByRole('heading', { name: '見つかった候補(1件)' })).toBeInTheDocument();
    expect(screen.getByText('出典: Wikipedia')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/¥|信頼度|★/);

    searchSpots.mockResolvedValueOnce({ success: true, data: { spots: [] } });
    await userEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByTestId('search-empty')).toHaveTextContent('候補が見つかりませんでした');

    searchSpots.mockResolvedValueOnce({ success: false, data: { spots: [] } });
    await userEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('検索できませんでした');
  });
});
