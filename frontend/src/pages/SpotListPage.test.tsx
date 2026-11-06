/** [Gate TripsWish] 行きたい場所: 数・種類の切り替え(数つき)・絞り込み・並べ替え・カードの情報(絵・住所・メモ・保存日・地図と出典)。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ listWishSpots: vi.fn(), createWishSpot: vi.fn(), updateWishSpot: vi.fn(), deleteWishSpot: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => api);
vi.mock('@/components/search/PlaceFinder', () => ({ default: () => null }));

import SpotListPage from './SpotListPage';
import { splitNote } from './spotListModel';

const spots = [
  { id: 's1', name: '清水寺', category: 'sightseeing', address: '京都府京都市東山区', description: '朝早く行く\nhttps://example.com/kiyomizu',
    latitude: 34.99, longitude: 135.78, price_range: null, image_url: null, created_at: '2026-10-01T03:00:00Z' },
  { id: 's2', name: 'あかり食堂', category: 'restaurant', address: null, description: null,
    latitude: null, longitude: null, price_range: null, image_url: null, created_at: '2026-10-05T03:00:00Z' },
];

beforeEach(() => { api.listWishSpots.mockReset(); api.listWishSpots.mockResolvedValue(spots); });
const renderPage = () => render(<MemoryRouter><SpotListPage /></MemoryRouter>);

describe('splitNote', () => {
  it('URL の行を出典として分ける', () => {
    expect(splitNote('メモ\nhttps://a.example/x\n続き')).toEqual({ memo: 'メモ\n続き', links: ['https://a.example/x'] });
    expect(splitNote(null)).toEqual({ memo: '', links: [] });
  });
});

describe('SpotListPage', () => {
  it('数と、カードの情報(種類の絵・住所・メモ・保存日・地図と出典のリンク)を出す', async () => {
    renderPage();
    const card = await screen.findByRole('listitem', { name: '清水寺' });
    expect(api.listWishSpots).toHaveBeenCalledWith('all');
    expect(screen.getByTestId('wish-kpis')).toHaveTextContent('保存した場所2');
    expect(screen.getByTestId('wish-kpis')).toHaveTextContent('地図の位置あり1');
    expect(card.querySelector('svg[data-kind="sightseeing"]')).not.toBeNull();
    expect(card).toHaveTextContent('京都府京都市東山区');
    expect(card).toHaveTextContent('朝早く行く');
    expect(card).not.toHaveTextContent('https://example.com/kiyomizu');
    expect(card).toHaveTextContent('2026/10/1');
    expect(within(card).getByRole('link', { name: /地図で見る/ })).toHaveAttribute('href', expect.stringContaining('openstreetmap.org'));
    expect(within(card).getByRole('link', { name: /出典を開く/ })).toHaveAttribute('href', 'https://example.com/kiyomizu');
    const other = screen.getByRole('listitem', { name: 'あかり食堂' });
    expect(other).toHaveTextContent('住所は未入力');
    expect(within(other).queryByRole('link')).toBeNull();
    // 新しい順が既定
    const names = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(names).toEqual(['あかり食堂', '清水寺']);
  });

  it('種類の切り替え(数つき)と、名前・住所・メモでの絞り込み', async () => {
    renderPage();
    await screen.findByRole('listitem', { name: '清水寺' });
    expect(screen.getByTestId('wish-cat-restaurant')).toHaveTextContent('レストラン1');
    fireEvent.click(screen.getByTestId('wish-cat-restaurant'));
    expect(screen.getByTestId('wish-cat-restaurant')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('listitem', { name: '清水寺' })).toBeNull();
    fireEvent.click(screen.getByTestId('wish-cat-all'));
    fireEvent.change(screen.getByLabelText('名前・住所・メモで絞り込む'), { target: { value: '東山' } });
    expect(screen.getByRole('listitem', { name: '清水寺' })).toBeInTheDocument();
    expect(screen.queryByRole('listitem', { name: 'あかり食堂' })).toBeNull();
    fireEvent.change(screen.getByLabelText('名前・住所・メモで絞り込む'), { target: { value: 'ない言葉' } });
    expect(screen.getByText('当てはまる場所はありません')).toBeInTheDocument();
  });

  it('まだ無い時は追加を案内する', async () => {
    api.listWishSpots.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('まだ行きたい場所がありません')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '最初の場所を追加' })).toBeInTheDocument();
  });
});
