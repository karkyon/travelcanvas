/** [FR-062] 行きたい場所の画面: 札の数と絞り込み・今までの行は今度・元の文・知らせのスイッチ・ここから日帰り・地域でまとめる・エリア */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

const api = vi.hoisted(() => ({ listWishSpots: vi.fn(), createWishSpot: vi.fn(), updateWishSpot: vi.fn(), deleteWishSpot: vi.fn(),
  patchWishSpot: vi.fn(), enrichWishSpot: vi.fn(), uploadSpotPhoto: vi.fn() }));
vi.mock('@/services/api/spotIntake', () => api);
vi.mock('@/components/search/PlaceFinder', () => ({ default: () => null }));

import SpotListPage from './SpotListPage';

const base = { description: null, price_range: null, image_url: null, category: 'sightseeing', created_at: '2026-11-28T03:00:00Z' };
const spots = [
  { ...base, id: 'old', name: '今までの寺', address: '京都府京都市東山区1', latitude: 34.99, longitude: 135.78 },
  { ...base, id: 'aka', name: '赤福 本店', address: '三重県伊勢市宇治中之切町26', latitude: 34.46, longitude: 136.72, wish_kind: 'next',
    wish_when: 'next_trip', source_kind: 'today', source_label: '伊勢・おかげ横丁の旅', wish_note: '時間がなくて行けず', remind_nearby: false },
  { ...base, id: 'nai', name: '内宮', address: '三重県伊勢市宇治館町1', latitude: 34.45, longitude: 136.72, wish_kind: 'again', again_count: 2,
    source_kind: 'visit', source_label: '伊勢・おかげ横丁の旅' },
  { ...base, id: 'area', name: 'おかげ横丁', address: null, latitude: 34.462, longitude: 136.725, wish_kind: 'again', wish_scope: 'area',
    radius_m: 400, source_label: '伊勢・おかげ横丁の旅' },
];

let loc = '';
const Where = () => { loc = `${useLocation().pathname}${useLocation().search}`; return null; };
const renderPage = () => render(<MemoryRouter initialEntries={['/spots']}><Routes>
  <Route path="/spots" element={<SpotListPage />} /><Route path="*" element={<Where />} /></Routes></MemoryRouter>);

beforeEach(() => { Object.values(api).forEach((f) => f.mockReset()); api.listWishSpots.mockResolvedValue(spots); loc = ''; });

describe('行きたい場所の札 (FR-062)', () => {
  it('札の数(今までの行は今度)と絞り込み', async () => {
    renderPage();
    await screen.findByRole('listitem', { name: '赤福 本店' });
    expect(screen.getByTestId('wish-kind-all')).toHaveTextContent('4');
    expect(screen.getByTestId('wish-kind-next')).toHaveTextContent('2');
    expect(screen.getByTestId('wish-kind-again')).toHaveTextContent('1');
    expect(screen.getByTestId('wish-kind-area')).toHaveTextContent('1');
    fireEvent.click(screen.getByTestId('wish-kind-next'));
    expect(screen.getAllByRole('listitem', { name: /./ }).map((x) => x.getAttribute('aria-label')).filter(Boolean).sort())
      .toEqual(['今までの寺', '赤福 本店']);
    expect(screen.getByTestId('wish-kindchip-old')).toHaveTextContent('今度行きたい');
  });

  it('残した元・次の旅行で・また行きたいの回数・エリアの半径', async () => {
    renderPage();
    const card = await screen.findByRole('listitem', { name: '赤福 本店' });
    expect(card).toHaveTextContent('伊勢・おかげ横丁の旅(11/28)の当日に保存 · 『時間がなくて行けず』');
    expect(card).toHaveTextContent('次の旅行で');
    expect(screen.getByTestId('wish-source-nai')).toHaveTextContent('また行きたい 2 回');
    expect(screen.getByTestId('wish-area-area')).toHaveTextContent('半径 400m');
  });

  it('近くに来たら知らせるのスイッチ', async () => {
    api.patchWishSpot.mockResolvedValue({ ...spots[1], remind_nearby: true });
    renderPage();
    const sw = await screen.findByTestId('wish-remind-aka');
    expect(sw).toHaveAttribute('role', 'switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    await waitFor(() => expect(screen.getByTestId('wish-remind-aka')).toHaveAttribute('aria-checked', 'true'));
    expect(api.patchWishSpot).toHaveBeenCalledWith('aka', { remind_nearby: true });
  });

  it('ここから日帰り・ここを歩くエリアにする(エリアの時だけ)', async () => {
    renderPage();
    await screen.findByRole('listitem', { name: '赤福 本店' });
    expect(screen.queryByTestId('wish-walkarea-aka')).toBeNull();
    expect(screen.getByTestId('wish-walkarea-area')).toBeTruthy();
    fireEvent.click(screen.getByTestId('wish-daytrip-aka'));
    expect(loc).toBe('/planner?new=1&mode=day&spot=aka');
  });

  it('地域でまとめる・近い順は位置をサーバーに送らない', async () => {
    const get = vi.fn((ok: PositionCallback) => ok({ coords: { latitude: 34.45, longitude: 136.72, accuracy: 30 } } as GeolocationPosition));
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: { getCurrentPosition: get } });
    renderPage();
    await screen.findByRole('listitem', { name: '赤福 本店' });
    fireEvent.change(screen.getByLabelText('並べ替え'), { target: { value: 'region' } });
    expect(screen.getAllByTestId('wish-region').map((x) => x.textContent)).toEqual(['京都府 京都市(1)', '三重県 伊勢市(2)', '住所なし(1)']);
    fireEvent.change(screen.getByLabelText('並べ替え'), { target: { value: 'near' } });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const list = screen.getAllByRole('list', { name: '行きたい場所の一覧' })[0]!;
    expect(within(list).getAllByRole('listitem').map((x) => x.getAttribute('aria-label')).filter(Boolean)[0]).toBe('内宮');
    expect(api.listWishSpots).toHaveBeenCalledTimes(1);  // 位置を付けて取り直さない
  });
});
