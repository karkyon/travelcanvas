/** [Gate WishMap] 行きたい場所の地図: 絞り込んだ結果だけを番号つきの印で出す・カードで選ぶと赤い大きな印と小窓・印を押すとカードを選ぶ。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ listWishSpots: vi.fn(), createWishSpot: vi.fn(), updateWishSpot: vi.fn(), deleteWishSpot: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => api);
vi.mock('@/components/search/PlaceFinder', () => ({ default: () => null }));

import SpotListPage from '../SpotListPage';
import { validLatLng, wishPoints, googleMapsUrl, osmUrl, shortMemo } from './wishMapModel';

const spots = [
  { id: 's1', name: '清水寺', category: 'sightseeing', address: '京都府京都市東山区', description: '朝早く行く',
    latitude: 34.99, longitude: 135.78, price_range: null, image_url: null, created_at: '2026-10-01T03:00:00Z' },
  { id: 's2', name: 'あかり食堂', category: 'restaurant', address: null, description: null,
    latitude: null, longitude: null, price_range: null, image_url: null, created_at: '2026-10-05T03:00:00Z' },
  { id: 's3', name: '錦市場', category: 'shopping', address: '京都府京都市中京区', description: null,
    latitude: 35.005, longitude: 135.765, price_range: null, image_url: null, created_at: '2026-10-03T03:00:00Z' },
];

beforeEach(() => { api.listWishSpots.mockReset(); api.listWishSpots.mockResolvedValue(spots); });
const renderPage = () => render(<MemoryRouter><SpotListPage /></MemoryRouter>);
const pins = () => Array.from(document.querySelectorAll('.leaflet-marker-icon .tc-pin'));

describe('wishMapModel', () => {
  it('位置のある場所だけに、一覧の順で番号を付ける', () => {
    const r = wishPoints(spots);
    expect(r.points.map((p) => [p.spot.id, p.no])).toEqual([['s1', 1], ['s3', 2]]);
    expect(r.noLocation).toBe(1);
    expect(r.numberOf.get('s3')).toBe(2);
  });
  it('おかしな位置は出さない・外部の地図の URL', () => {
    expect(validLatLng(0, 0)).toBe(false);
    expect(validLatLng(91, 10)).toBe(false);
    expect(validLatLng(35, 135)).toBe(true);
    expect(googleMapsUrl(35, 135)).toContain('google.com/maps/search/?api=1&query=35%2C135');
    expect(osmUrl(35, 135)).toContain('openstreetmap.org');
    expect(shortMemo('a'.repeat(200), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('行きたい場所の地図', () => {
  it('絞り込んだ結果だけを番号つきの印で出し、カードにも同じ番号を出す', async () => {
    renderPage();
    await screen.findByRole('listitem', { name: '清水寺' });
    const map = screen.getByTestId('wish-map');
    expect(map).toHaveTextContent('地図に 2 か所');
    expect(map).toHaveTextContent('位置の無い場所 1 か所は地図に出ません');
    await waitFor(() => expect(pins()).toHaveLength(2));
    // 新しい順: あかり食堂(位置なし)→ 錦市場(1)→ 清水寺(2)
    expect(within(screen.getByRole('listitem', { name: '錦市場' })).getByText('1')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: '清水寺' })).getByText('2')).toBeInTheDocument();
    expect(within(screen.getByRole('listitem', { name: 'あかり食堂' })).queryByRole('button', { name: /地図で表示/ })).toBeNull();
    fireEvent.click(screen.getByTestId('wish-cat-shopping'));
    await waitFor(() => expect(pins()).toHaveLength(1));
    expect(screen.getByTestId('wish-map')).toHaveTextContent('地図に 1 か所');
    fireEvent.click(screen.getByTestId('wish-cat-restaurant'));
    expect(await screen.findByTestId('wish-map-empty')).toBeInTheDocument();
  });

  it('カードの「地図で表示」で、旅程と同じ形の赤い大きな印にし、詳しい内容の小窓を出す', async () => {
    renderPage();
    const card = await screen.findByRole('listitem', { name: '清水寺' });
    await waitFor(() => expect(pins()).toHaveLength(2));
    fireEvent.click(within(card).getByRole('button', { name: '「清水寺」を地図で表示' }));
    expect(card).toHaveAttribute('data-selected', 'true');
    await waitFor(() => expect(document.querySelectorAll('.tc-pin.is-sel')).toHaveLength(1));
    const sel = document.querySelector('.tc-pin.is-sel') as HTMLElement;
    expect(sel.textContent).toBe('2');
    expect(sel.style.background).toMatch(/220, 38, 38|#dc2626/);
    const pop = await screen.findByTestId('wish-pop-s1', {}, { timeout: 2000 });
    expect(pop).toHaveTextContent('清水寺');
    expect(pop).toHaveTextContent('京都府京都市東山区');
    expect(pop).toHaveTextContent('朝早く行く');
    expect(within(pop).getByRole('button', { name: /旅行に追加/ })).toBeInTheDocument();
    expect(within(pop).getByRole('link', { name: /Google マップ/ })).toHaveAttribute('href', expect.stringContaining('google.com/maps'));
  });

  it('地図の印を押すと、その場所のカードを選ぶ。地図は隠せる', async () => {
    renderPage();
    await screen.findByRole('listitem', { name: '錦市場' });
    await waitFor(() => expect(pins()).toHaveLength(2));
    const marker = document.querySelector('.leaflet-marker-icon[title="1. 錦市場"]') as HTMLElement;
    fireEvent.click(marker);
    await waitFor(() => expect(screen.getByRole('listitem', { name: '錦市場' })).toHaveAttribute('data-selected', 'true'));
    fireEvent.click(screen.getByTestId('wish-map-toggle'));
    expect(screen.queryByTestId('wish-map')).toBeNull();
    expect(screen.getByTestId('wish-map-toggle')).toHaveTextContent('地図を表示');
  });
});
