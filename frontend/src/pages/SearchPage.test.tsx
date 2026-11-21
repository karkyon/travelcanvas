/**
 * [Gate Honesty] スポット検索の言葉を実際に合わせる(AI・画像の解析・音声の認識は未接続)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const { searchSpots, searchNearby } = vi.hoisted(() => ({ searchSpots: vi.fn(), searchNearby: vi.fn() }));
vi.mock('../services/api', () => ({ searchSpots }));
vi.mock('../services/api/g11discover', () => ({ searchNearby }));

import SearchPage from './SearchPage';
import { jpegWithGps } from '@/components/search/findModel.fixture';

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
    expect(screen.getByTestId('search-unconnected')).toHaveAttribute('data-cert', 'unconnected');
    expect(document.body.textContent).not.toMatch(/AI(が|で)?(インターネット|画像解析|音声認識|検索エンジン|信頼度|推奨|分析)/);
  });

  it('[SpotFind] 写真から探す: 撮影場所(Exif の GPS)の周りを探す。位置の無い写真は理由を示す', async () => {
    searchNearby.mockResolvedValue({ candidates: [{ id: 'n1', name: '伊勢神宮', category: 'attraction', kind: 'shrine_temple',
      provider: 'wikipedia', description: null, location: { latitude: 34.45, longitude: 136.72, address: '三重県伊勢市' } }] });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /写真から探す/ }));
    const input = screen.getByTestId('find-photo-input') as HTMLInputElement;
    await userEvent.upload(input, new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' }));
    expect(await screen.findByTestId('find-photo-note')).toHaveTextContent('JPEG');
    await userEvent.upload(input, new File([jpegWithGps(34.455, 136.725)], 'b.jpg', { type: 'image/jpeg' }));
    expect(await screen.findByTestId('find-photo-point')).toHaveTextContent('緯度 34.4550・経度 136.7250');
    expect(searchNearby).toHaveBeenCalledWith(expect.objectContaining({ latitude: 34.455, longitude: 136.725, radius_km: 2 }));
    expect(await screen.findByText('伊勢神宮')).toBeInTheDocument();
  });

  it('[SpotFind] SNS から探す: 投稿の文から言葉を拾い、押すとその言葉で探す。URL だけは読まないと示す', async () => {
    searchSpots.mockResolvedValue({ success: true, data: { spots: [] } });
    renderPage();
    await userEvent.click(screen.getByRole('tab', { name: /SNS から探す/ }));
    const box = screen.getByLabelText('投稿の文を貼る');
    await userEvent.type(box, 'https://www.instagram.com/p/abc');
    await userEvent.click(screen.getByTestId('find-sns-pick'));
    expect(screen.getByTestId('find-sns-none')).toHaveTextContent('URL だけでは中身を読めません');
    await userEvent.clear(box);
    await userEvent.type(box, '伊勢神宮にお参り #おかげ横丁');
    await userEvent.click(screen.getByTestId('find-sns-pick'));
    await userEvent.click(screen.getByTestId('find-sns-word-おかげ横丁'));
    expect(searchSpots).toHaveBeenCalledWith(expect.objectContaining({ query: 'おかげ横丁' }));
    expect(screen.getByTestId('search-used-words')).toHaveTextContent('「おかげ横丁」で探しました');
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
    // [Gate② UX P0] 押す前に保存先の違いが分かる
    const guide = screen.getByTestId('search-save-guide');
    expect(guide).toHaveTextContent('その旅行の 1 日目に時刻なしの予定として入ります');
    expect(guide).toHaveTextContent('まだどの旅行の予定にもなりません');
    expect(screen.getByRole('button', { name: '「清水寺」をプランに追加' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '「清水寺」を行きたい場所に保存' })).toBeInTheDocument();

    searchSpots.mockResolvedValueOnce({ success: true, data: { spots: [] } });
    await userEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByTestId('search-empty')).toHaveTextContent('候補が見つかりませんでした');
    expect(screen.queryByTestId('search-failed')).not.toBeInTheDocument();  // 0 件は取得失敗ではない

    searchSpots.mockResolvedValueOnce({ success: false, data: { spots: [] } });
    await userEvent.click(screen.getByRole('button', { name: '探す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('検索できませんでした');
    // [Gate② UX P0] 取得失敗の印(0 件の時は出さない)
    expect(screen.getByTestId('search-failed')).toHaveAttribute('data-cert', 'failed');
    expect(screen.getByTestId('search-failed')).toHaveTextContent('取得失敗');
  });
});

describe('[Gate2 G2-08] 位置の許可は押した時だけ', () => {
  beforeEach(() => { localStorage.removeItem('search_preferences'); });
  it('画面を開いただけでは現在地を取りに行かず、押すと取りに行く', async () => {
    const getCurrentPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number } }) => void) => ok({ coords: { latitude: 34.46, longitude: 136.72 } }));
    Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true });
    renderPage();
    expect(getCurrentPosition).not.toHaveBeenCalled();
    await userEvent.click(screen.getByTestId('search-use-location'));
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/座標を検索サービスへ送ります/)).toBeInTheDocument();
  });
});
