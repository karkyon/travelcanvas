/**
 * [Gate AddEventForm][Gate SpotFromMedia] 予定を追加: 名前で検索から手で入力へ移ると自動取得する・複数の候補をまとめて追加する。
 * PlaceFinder: 動画の説明欄の候補を複数選ぶ・写真は AI の同意がある時だけ送る・貼った文から拾う。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({
  getPlaceInfo: vi.fn(), addNewScheduleItem: vi.fn(), readPlaceUrl: vi.fn(), placesFromText: vi.fn(),
  aiPlacesFromImage: vi.fn(), aiPlacesFromText: vi.fn(), listWishSpots: vi.fn(), findPlaces: vi.fn(), getExternalThumb: vi.fn(),
}));
vi.mock('@/services/api/planEdit', () => ({ getPlaceInfo: m.getPlaceInfo, geocodeAddress: vi.fn(), reorderDay: vi.fn() }));
vi.mock('@/services/api/g11planner', () => ({ getHoursCheck: vi.fn().mockResolvedValue({ events: [] }) }));
vi.mock('@/services/api/g11discover', () => ({
  getEventImages: vi.fn().mockResolvedValue({}), getEventImageMedia: vi.fn(), getMediaProviderStatus: vi.fn().mockResolvedValue({ image_providers: [] }),
  searchNearby: vi.fn().mockResolvedValue({ candidates: [] }), getExternalThumb: m.getExternalThumb,
}));
vi.mock('@/services/api/g11', () => ({ getPlanCover: vi.fn().mockResolvedValue({ cover: null, can_edit: false }) }));
vi.mock('@/services/api/spotIntake', () => ({
  readPlaceUrl: m.readPlaceUrl, placesFromText: m.placesFromText, aiPlacesFromImage: m.aiPlacesFromImage,
  aiPlacesFromText: m.aiPlacesFromText, listWishSpots: m.listWishSpots, findPlaces: m.findPlaces,
}));
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ addNewScheduleItem: m.addNewScheduleItem, deleteScheduleItem: vi.fn(), reorderSpots: vi.fn() }),
}));
vi.mock('@/components/common/toastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));

import DayView from '@/components/DayView';
import PlaceFinder from '@/components/search/PlaceFinder';
import type { DaySchedule } from '@/types';
// [Gate BookingBadge] 予約の札の読み込み(旅程の予定ごと)は空にする
vi.mock('@/services/api/bookingStatus', () => ({
  getBookingStatus: vi.fn().mockResolvedValue({ party_size: null, events: {} }), linkReservationToEvent: vi.fn(),
}));


const day = (): DaySchedule => ({ id: 'd1', date: '2026-11-28', timezone_id: 'Asia/Tokyo', events: [
  { id: 'e1', title: '鳥羽城', category: 'sightseeing', latitude: 34.48, longitude: 136.84 } as DaySchedule['events'][number],
] });
const info = (name: string, address: string) => ({
  provider: 'multi', attribution: '', license: '', license_url: '', cached: false, unavailable: false, error_code: null, sources: [],
  candidates: [{ name, address, phone: '0596-24-1111', website: 'https://www.isejingu.or.jp/', category: 'sightseeing', osm_type: null,
    latitude: 34.455, longitude: 136.725, source_url: null, links: [], notes: [] }],
});

beforeEach(() => { for (const f of Object.values(m)) f.mockReset(); m.listWishSpots.mockResolvedValue([]); localStorage.removeItem('tc-ai-photo-consent'); });

describe('予定を追加', () => {
  it('名前で検索に入れた名前で、手で入力へ移ると自動取得して主な情報を入れる', async () => {
    m.getPlaceInfo.mockResolvedValue(info('伊勢神宮 内宮', '三重県伊勢市宇治館町1'));
    m.addNewScheduleItem.mockResolvedValue(undefined);
    render(<DayView day={day()} planId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 予定を追加' }));
    fireEvent.click(await screen.findByRole('tab', { name: '名前で検索' }));
    fireEvent.change(screen.getByLabelText('場所の名前'), { target: { value: '伊勢神宮' } });
    fireEvent.click(screen.getByRole('tab', { name: '手で入力' }));
    await waitFor(() => expect(screen.getByLabelText('場所・住所')).toHaveValue('三重県伊勢市宇治館町1'));
    expect(screen.getByLabelText('タイトル *')).toHaveValue('伊勢神宮');
    expect(screen.getByLabelText('電話番号')).toHaveValue('0596-24-1111');
    expect(screen.getByLabelText('URL 1')).toHaveValue('https://www.isejingu.or.jp/');
    expect(m.getPlaceInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '伊勢神宮', latitude: 34.48, longitude: 136.84 }));
    // 時刻と滞在時間で終わりが決まる
    fireEvent.change(screen.getByTestId('new-start'), { target: { value: '10:00' } });
    fireEvent.change(screen.getByLabelText('滞在(時間)'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('滞在(分)'), { target: { value: '30' } });
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(m.addNewScheduleItem).toHaveBeenCalledWith('p1', 'd1', expect.objectContaining({
      title: '伊勢神宮', address: '三重県伊勢市宇治館町1', start_time: '10:00', end_time: '11:30', latitude: 34.455,
      urls: [{ url: 'https://www.isejingu.or.jp/', label: null }],
    })));
  });

  it('動画の説明欄の候補を複数選んで、それぞれ自動取得してから追加する', async () => {
    m.readPlaceUrl.mockResolvedValue({ kind: 'sns', ok: true, url: 'https://www.youtube.com/watch?v=x', name: null, title: '伊勢の旅',
      author: 'a', reason: null, description: '説明', address: null, latitude: null, longitude: null, suggestions: [],
      places: [{ name: '二見興玉神社', time: '1:04', context: '1:04 二見興玉神社紹介' }, { name: 'おかげ横丁', time: '7:18', context: '' },
        { name: '赤福本店', time: '7:18', context: '', quoted: false }], description_available: true });
    m.getPlaceInfo.mockImplementation(async ({ name }: { name: string }) => info(name, `三重県伊勢市 ${name}`));
    m.addNewScheduleItem.mockResolvedValue(undefined);
    render(<DayView day={day()} planId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 予定を追加' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'SNS・URL' }));
    fireEvent.change(screen.getByLabelText('URL'), { target: { value: 'https://www.youtube.com/watch?v=x' } });
    fireEvent.click(screen.getByRole('button', { name: '読む' }));
    fireEvent.click(await screen.findByTestId('finder-check-二見興玉神社'));
    fireEvent.click(screen.getByTestId('finder-check-おかげ横丁'));
    fireEvent.click(screen.getByTestId('finder-add-many'));
    await waitFor(() => expect(m.addNewScheduleItem).toHaveBeenCalledTimes(2));
    expect(m.addNewScheduleItem.mock.calls[0]![2]).toEqual(expect.objectContaining({ title: '二見興玉神社', address: '三重県伊勢市 二見興玉神社' }));
    expect(m.addNewScheduleItem.mock.calls[1]![2]).toEqual(expect.objectContaining({ title: 'おかげ横丁' }));
  });
});

describe('PlaceFinder の写真・文', () => {
  it('写真は同意してから AI へ送る(文字の読み取りは使わない)', async () => {
    m.aiPlacesFromImage.mockResolvedValue([{ name: '伊勢神宮内宮', reason: '宇治橋', confidence: 0.9, address: '三重県伊勢市宇治館町1' }]);
    const onPick = vi.fn();
    render(<PlaceFinder tab="photo" onTab={vi.fn()} onPick={onPick} planId="p1" />);
    const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    const ai = await screen.findByTestId('finder-photo-ai');
    expect(ai).toBeDisabled();
    fireEvent.click(screen.getByTestId('finder-ai-consent'));
    fireEvent.click(ai);
    expect(await screen.findByText('伊勢神宮内宮')).toBeInTheDocument();
    expect(screen.getByText(/AI: 宇治橋\(確からしさ 90%\)/)).toBeInTheDocument();
    expect(m.aiPlacesFromImage).toHaveBeenCalledWith('p1', file);
  });

  it('貼った説明欄から場所を拾う', async () => {
    m.placesFromText.mockResolvedValue([{ name: '猿田彦神社', time: '6:31', context: '6:31 猿田彦神社紹介' }]);
    render(<PlaceFinder tab="url" onTab={vi.fn()} onPick={vi.fn()} />);
    fireEvent.change(screen.getByLabelText(/投稿の文・説明欄を貼る/), { target: { value: '6:31 猿田彦神社紹介' } });
    fireEvent.click(screen.getByTestId('finder-paste-find'));
    expect(await screen.findByText('猿田彦神社')).toBeInTheDocument();
    expect(screen.getByText(/動画 6:31/)).toBeInTheDocument();
  });

  it('[PlaceFinderArea] 名前で検索: 言葉とジャンル・範囲で探し、ジャンルの札・距離・探した範囲・出典を出す', async () => {
    m.findPlaces.mockResolvedValue({ query: '菰野 カフェ', genre: 'cafe', genre_label: 'カフェ', scope: 'area',
      region: { label: 'この旅行の範囲(予定の真ん中から 8km 以内)', radius_km: 8 },
      candidates: [{ name: '湯の山カフェ', address: '三重県三重郡菰野町菰野8500', latitude: 35.01, longitude: 136.46, category: 'dining',
        genre_label: 'カフェ', distance_km: 2.1, providers: ['yahoo_local'] }],
      sources: [{ provider: 'yahoo_local', label: 'Yahoo!ローカルサーチ', credit: 'Webサービス by Yahoo! JAPAN', url: 'https://developer.yahoo.co.jp/sitemap/' }],
      keyed_providers: ['yahoo_local'], failed_providers: [] });
    const onPick = vi.fn();
    render(<PlaceFinder tab="search" onTab={vi.fn()} onPick={onPick} planId="p1" />);
    fireEvent.change(screen.getByLabelText('場所の名前'), { target: { value: '菰野' } });
    fireEvent.change(screen.getByTestId('finder-genre'), { target: { value: 'cafe' } });
    fireEvent.click(screen.getByTestId('finder-scope-route'));
    fireEvent.click(screen.getByTestId('finder-search'));
    await waitFor(() => expect(m.findPlaces).toHaveBeenCalledWith('p1', '菰野', 'cafe', 'route'));
    const row = await screen.findByTestId('finder-row-湯の山カフェ');
    expect(row).toHaveTextContent('湯の山カフェカフェ経路から 2.1km');
    expect(screen.getByTestId('finder-region')).toHaveTextContent('探した範囲: この旅行の範囲(予定の真ん中から 8km 以内)');
    expect(screen.getByTestId('finder-credits')).toHaveTextContent('Webサービス by Yahoo! JAPAN');
    // ジャンルだけでも探せる
    fireEvent.change(screen.getByLabelText('場所の名前'), { target: { value: '' } });
    expect(screen.getByTestId('finder-search')).not.toBeDisabled();
  });

  it('[PlaceFinderArea] 写真: 撮影場所が無ければ(同意済みなら)すぐ写真から見分け、旅行の範囲の外に印。範囲で同じ種類も探せる', async () => {
    localStorage.setItem('tc-ai-photo-consent', '1');
    m.aiPlacesFromImage.mockResolvedValue([
      { name: '伊勢神宮内宮', reason: '宇治橋', confidence: 0.9, category: 'sightseeing', distance_km: 3.2, in_trip: true },
      { name: '明治神宮', reason: '鳥居', confidence: 0.4, category: 'sightseeing', distance_km: 300, in_trip: false },
    ]);
    m.findPlaces.mockResolvedValue({ query: '', genre: 'sightseeing', genre_label: '観光名所', scope: 'area',
      region: { label: 'この旅行の範囲', radius_km: 8 }, candidates: [], sources: [], keyed_providers: ['yahoo_local'], failed_providers: [] });
    render(<PlaceFinder tab="photo" onTab={vi.fn()} onPick={vi.fn()} planId="p1" />);
    const file = new File([new Uint8Array([1, 2, 3])], 'p.jpg', { type: 'image/jpeg' });
    fireEvent.change(document.querySelector('input[type="file"]')!, { target: { files: [file] } });
    await waitFor(() => expect(m.aiPlacesFromImage).toHaveBeenCalledWith('p1', file));
    expect(await screen.findByTestId('finder-row-明治神宮')).toHaveTextContent('旅行の範囲の外');
    expect(screen.getByTestId('finder-row-伊勢神宮内宮')).not.toHaveTextContent('旅行の範囲の外');
    expect(screen.queryByText(/GPS/)).toBeNull();
    fireEvent.click(screen.getByTestId('finder-photo-similar'));
    await waitFor(() => expect(m.findPlaces).toHaveBeenCalledWith('p1', '', 'sightseeing', 'area'));
  });

  it('[PlaceFinderArea] 行きたい場所: 写真とジャンルの札(食事は料理のジャンル)', async () => {
    m.listWishSpots.mockResolvedValue([
      { id: 's1', name: '赤福 本店', description: null, category: 'dining', address: null, latitude: null, longitude: null,
        price_range: null, image_url: null, created_at: '', dining: { genres: ['和菓子'] } },
      { id: 's2', name: '夫婦岩', description: null, category: 'sightseeing', address: null, latitude: null, longitude: null,
        price_range: null, image_url: null, created_at: '', photo: { provider: 'commons', provider_id: 'File:x.jpg', author: 'A', license: 'CC BY' } },
    ]);
    m.getExternalThumb.mockResolvedValue(new Blob(['x']));
    render(<PlaceFinder tab="wish" onTab={vi.fn()} onPick={vi.fn()} withWish planId="p1" />);
    expect(await screen.findByTestId('finder-row-赤福 本店')).toHaveTextContent('赤福 本店食事・和菓子');
    expect(screen.getByTestId('finder-row-赤福 本店')).toHaveTextContent('写真なし');
    expect(screen.getByTestId('finder-row-夫婦岩')).toHaveTextContent('夫婦岩観光');
    await waitFor(() => expect(m.getExternalThumb).toHaveBeenCalledWith('commons', 'File:x.jpg'));
  });
});
