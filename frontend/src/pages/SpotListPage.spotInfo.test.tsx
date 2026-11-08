/**
 * [Gate SpotInfo] 行きたい場所: 電話(tel:)・URL・写真・食事の情報、フォームの自動取得(候補を選んで入れる)、
 * カードの自動取得(空の項目だけ)。外への送信はしない(API は差し替える)。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({
  listWishSpots: vi.fn(), createWishSpot: vi.fn(), updateWishSpot: vi.fn(), deleteWishSpot: vi.fn(), enrichWishSpot: vi.fn(),
}));
vi.mock('@/services/api/spotIntake', () => api);
const place = vi.hoisted(() => ({ getPlaceInfo: vi.fn(), getPlacePhoto: vi.fn() }));
vi.mock('@/services/api/planEdit', () => place);
vi.mock('@/services/api/g11discover', () => ({
  getExternalThumb: vi.fn(async () => new Blob(['x'], { type: 'image/jpeg' })), searchExternalImages: vi.fn(), importExternalImage: vi.fn(),
}));
vi.mock('@/components/search/PlaceFinder', () => ({ default: () => null }));

import SpotListPage from './SpotListPage';

const sushi = {
  id: 's1', name: '門司港 地魚屋', category: 'restaurant', address: '福岡県北九州市門司区港町1-1', description: null,
  latitude: 33.946, longitude: 130.962, price_range: null, image_url: null, created_at: '2026-10-01T03:00:00Z',
  phone: '093-321-0000', urls: [{ url: 'https://jizakana.example/', label: null }],
  photo: { provider: 'wikimedia_commons', provider_id: 'File:Moji.jpg', author: 'B', license: 'CC BY 4.0', source_page_url: 'https://commons.wikimedia.org/wiki/File:Moji.jpg' },
  dining: { genres: ['kaisen', 'sushi'], signature: '地魚の海鮮丼', budget_lunch: '1000_2000', parking: 'nearby', reservation: 'recommended', payment: ['cash', 'qr'] },
};
const plain = { id: 's2', name: '焼きカレー屋', category: 'other', address: null, description: null, latitude: null, longitude: null,
  price_range: null, image_url: null, created_at: '2026-10-05T03:00:00Z' };

beforeEach(() => {
  for (const f of [...Object.values(api), ...Object.values(place)]) f.mockReset();
  api.listWishSpots.mockResolvedValue([sushi, plain]);
  globalThis.URL.createObjectURL = vi.fn(() => 'blob:x');
  globalThis.URL.revokeObjectURL = vi.fn();
  window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
});
const renderPage = () => render(<MemoryRouter><SpotListPage /></MemoryRouter>);

describe('行きたい場所の情報', () => {
  it('カードに写真(作者・ライセンス)・食事の情報・電話(tel:)・URL を出す', async () => {
    renderPage();
    const card = await screen.findByRole('listitem', { name: '門司港 地魚屋' });
    expect(within(card).getByTestId('spot-photo')).toHaveTextContent('B · CC BY 4.0');
    const dining = within(card).getByTestId('dining-summary');
    expect(dining).toHaveTextContent('海鮮');
    expect(dining).toHaveTextContent('地魚の海鮮丼');
    expect(dining).toHaveTextContent('1,000〜2,000円');
    expect(dining).toHaveTextContent('近くにコインパーキング');
    expect(dining).toHaveTextContent('現金・QR 決済');
    expect(within(card).getByRole('link', { name: '電話をかける 093-321-0000' })).toHaveAttribute('href', 'tel:0933210000');
    expect(within(card).getByRole('link', { name: /jizakana\.example/ })).toHaveAttribute('target', '_blank');
  });

  it('カードの「自動取得」は空の項目だけを埋め、埋めた項目を知らせる', async () => {
    api.enrichWishSpot.mockResolvedValue({ spot: { ...plain, category: 'restaurant', phone: '093-0000', dining: { genres: ['curry'] } },
      filled: ['phone', 'category', 'dining'], matched: true, source: {} });
    renderPage();
    const card = await screen.findByRole('listitem', { name: '焼きカレー屋' });
    fireEvent.click(within(card).getByRole('button', { name: '「焼きカレー屋」の情報を自動取得' }));
    expect(await screen.findByRole('status')).toHaveTextContent('電話・種類・食事の情報 を入れました');
    expect(api.enrichWishSpot).toHaveBeenCalledWith('s2');
    expect(await screen.findByRole('listitem', { name: '焼きカレー屋' })).toHaveTextContent('カレー');
  });

  it('フォームの自動取得: 候補を選ぶと住所・電話・公式サイト・食事の情報・写真が入り、保存で送る', async () => {
    place.getPlaceInfo.mockResolvedValue({ provider: 'nominatim', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0',
      license_url: '', cached: false, unavailable: false, error_code: null,
      candidates: [{ name: '焼きカレー屋', address: '福岡県北九州市門司区港町2-2', phone: '093-111-2222', website: 'https://curry.example/',
        category: 'dining', osm_type: 'restaurant', latitude: 33.95, longitude: 130.96, source_url: null,
        dining: { genres: ['curry'], hours: '11:00-20:00' }, photo_file: 'File:Curry.jpg', wikidata: null }] });
    place.getPlacePhoto.mockResolvedValue({ provider: 'wikimedia_commons', provider_id: 'File:Curry.jpg', title: 'カレー', author: 'C',
      license: 'CC BY-SA 4.0', license_url: null, attribution: null, source_page_url: null, width: 1, height: 1, mime: 'image/jpeg',
      retrieved_at: '2026-11-07', importable: true });
    api.updateWishSpot.mockResolvedValue({ ...plain });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '「焼きカレー屋」を編集' }));
    expect(screen.getAllByLabelText(/^URL \d$/)).toHaveLength(1);
    fireEvent.click(screen.getByTestId('wish-lookup'));
    expect(place.getPlaceInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '焼きカレー屋', latitude: null, longitude: null }));
    fireEvent.click(await screen.findByTestId('wish-lookup-use-0'));
    await waitFor(() => expect(screen.getByTestId('wish-photo')).toHaveTextContent('C · CC BY-SA 4.0'));
    expect(screen.getByLabelText('住所')).toHaveValue('福岡県北九州市門司区港町2-2');
    expect(screen.getByLabelText('電話番号')).toHaveValue('093-111-2222');
    expect(screen.getByLabelText('URL 1')).toHaveValue('https://curry.example/');
    expect(screen.getByLabelText('種類')).toHaveValue('restaurant');
    const fields = screen.getByTestId('dining-fields');
    expect(within(fields).getByTestId('dining-genre-curry')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(fields).getByTestId('dining-genre-ramen'));
    fireEvent.change(within(fields).getByLabelText('駐車場'), { target: { value: 'yes' } });
    fireEvent.change(within(fields).getByLabelText('名物・おすすめの料理'), { target: { value: '焼きカレー' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.updateWishSpot).toHaveBeenCalledTimes(1));
    expect(api.updateWishSpot.mock.calls[0]![1]).toMatchObject({
      phone: '093-111-2222', urls: [{ url: 'https://curry.example/', label: null }], category: 'restaurant',
      latitude: 33.95, longitude: 130.96,
      photo: { provider_id: 'File:Curry.jpg', author: 'C' },
      dining: { genres: ['curry', 'ramen'], hours: '11:00-20:00', parking: 'yes', signature: '焼きカレー' },
    });
  });

  it('ジャンルは 3 つまで', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '「門司港 地魚屋」を編集' }));
    const fields = screen.getByTestId('dining-fields');
    fireEvent.click(within(fields).getByTestId('dining-genre-ramen'));
    expect(within(fields).getByTestId('dining-genre-curry')).toBeDisabled();
    await waitFor(() => expect(screen.getAllByAltText('門司港 地魚屋').length).toBeGreaterThanOrEqual(2)); // 写真の読み込みを待つ
  });
});
