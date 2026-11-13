/**
 * [Gate TDay] 旅の当日「旅帖ライブ」: ライブ帯・旅の糸・出発の合図・次の場所・空模様・寄り道・旅帖の印・お助け・
 * 移動モード・旅の前・夜のふりかえり・知らせ。backend(today/guide・weather)の応答を固定して確かめる。
 */
import 'fake-indexeddb/auto';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { TodayResponse } from '@/services/api';
import type { TodayGuide } from '@/services/api/travelDay';

const m = vi.hoisted(() => ({
  getToday: vi.fn(),
  getTodayGuide: vi.fn(),
  getWeather: vi.fn(),
  findDetours: vi.fn(),
  addDetourEvent: vi.fn(async () => ({})),
  pressStamp: vi.fn(async () => ({})),
  addNote: vi.fn(async () => ({})),
  getEta: vi.fn(async () => ({ plan_id: 'p', shares: [], max_hours: 24, notice: '' })),
  putEta: vi.fn(),
}));
vi.mock('@/services/api', () => ({
  getToday: m.getToday,
  getOfflinePackKey: vi.fn(async () => ({ user_id: 'u', key_version: 1, key: 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcYGRobHB0eHyA',
    algorithm: 'AES-256-GCM', key_bits: 256, issued_at: '2026-05-01T00:00:00Z' })),
  travelAPI: { getPlan: vi.fn(async () => ({ success: true, data: { id: 'plan-t', title: '滋賀・大津 1泊2日', destination: '大津' } })) },
}));
vi.mock('@/services/api/travelDay', () => ({
  getTodayGuide: m.getTodayGuide, findDetours: m.findDetours, addDetourEvent: m.addDetourEvent, pressStamp: m.pressStamp,
  removeStamp: vi.fn(), addNote: m.addNote, addMedia: vi.fn(), getEta: m.getEta, putEta: m.putEta, deleteEta: vi.fn(),
}));
vi.mock('@/services/api/dayVariants', () => ({ getWeather: m.getWeather }));
vi.mock('@/services/api/photoFeatures', () => ({ getMemoryThumbnail: vi.fn(async () => { throw new Error('x'); }) }));
vi.mock('@/services/api/tripIntent', () => ({ getAreaImages: vi.fn(async () => ({})) }));
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => ({ userId: 'u', sessionTag: 's', legacyToken: null }) }));
vi.mock('./today/TodaySwitchPanel', () => ({ default: () => null }));
vi.mock('./today/live/TodayMap', () => ({ default: () => <div data-testid="today-map">地図</div> }));

import TodayPage from './TodayPage';
import { clearSnapshots } from '@/utils/offlineVault';

const PLAN = 'plan-t';
const NOW = '2026-11-13T03:00:00Z'; // 12:00 JST
const e = (id: string, title: string, start: string, over: Record<string, unknown> = {}) => ({
  id, title, event_type: 'sightseeing', start_at: start, end_at: null, local_start_time: null, address: null,
  latitude: 35.0, longitude: 135.86, has_ticket: false, reservation_id: null, time_source: 'local_start_time',
  departure_at: null, transport_mode: null, transport_status: null, ...over,
});
const events = [
  e('a', '大津駅', '2026-11-13T01:30:00Z'),
  e('b', '浜大津の湖岸', '2026-11-13T02:00:00Z', { end_at: '2026-11-13T03:10:00Z' }),
  e('c', 'テラスでランチ', '2026-11-13T03:30:00Z', { event_type: 'dining', reservation_id: 'r1' }),
  e('d', '本要寺', '2026-11-13T05:15:00Z'),
  e('f', '三尾神社', '2026-11-13T06:45:00Z'),
];
const today = (over: Partial<TodayResponse> = {}): TodayResponse => ({
  plan_id: PLAN, today_date: '2026-11-13', timezone_id: 'Asia/Tokyo', server_time: NOW,
  now_event: events[1] as never, next_event: events[2] as never, minutes_until_next: 30,
  day_end_at: '2026-11-13T15:00:00Z', events: events as never, ...over,
});
const gEvent = (id: string, over: Record<string, unknown> = {}) => ({
  event_id: id, place_id: null, phone: null, image_memory_id: null, end_at: null, end_estimated: false,
  travel_minutes: null, travel_mode: null, distance_km: null, travel_source: null, leave_by: null, fit: 'outdoor', hours: null, start_at: null, from_event_id: null, segment_id: null, segment_revision: null,
  segment_departure_at: null, ...over,
});
const guide = (over: Partial<TodayGuide> = {}): TodayGuide => ({
  plan_id: PLAN, server_time: NOW, day_id: 'day-1', day_title: '湖のまち、大津をめぐる日', local_date: '2026-11-13',
  timezone_id: 'Asia/Tokyo', day_index: 1, day_count: 2, is_last_day: false, upcoming: null,
  next_day: { date: '2026-11-14', day_title: null, event_count: 3, first_event_title: '石山寺', first_event_time: '09:30' },
  min_gap_minutes: 30,
  events: {
    a: gEvent('a'), b: gEvent('b'),
    c: gEvent('c', { leave_by: '2026-11-13T03:18:00Z', travel_minutes: 12, travel_source: 'estimate', fit: 'indoor',
      phone: '077-000-0000', hours: { status: 'ok', reason: null, window_label: null, closes_at: '21:00', minutes_to_close: 300,
        last_entry: null, last_order: null, estimated: true, stale: false } }),
    d: gEvent('d', { end_at: '2026-11-13T05:55:00Z', end_estimated: true, fit: 'indoor' }),
    f: gEvent('f', { leave_by: '2026-11-13T06:40:00Z', travel_minutes: 5, travel_source: 'estimate' }),
  },
  gaps: [{ after_event_id: 'd', before_event_id: 'f', start_at: '2026-11-13T05:55:00Z', end_at: '2026-11-13T06:40:00Z', minutes: 45 }],
  stamps: {
    a: { status: 'visited', revision: 1, actual_start_at: '2026-11-13T01:31:00Z', memory_count: 1, photo_count: 0 },
    b: { status: null, revision: null, actual_start_at: null, memory_count: 0, photo_count: 0 },
    c: { status: null, revision: null, actual_start_at: null, memory_count: 0, photo_count: 0 },
    d: { status: null, revision: null, actual_start_at: null, memory_count: 0, photo_count: 0 },
    f: { status: null, revision: null, actual_start_at: null, memory_count: 0, photo_count: 0 },
  },
  metrics: { visited: 1, total: 5, photos: 0, notes: 1 }, ...over,
});
const hours = Array.from({ length: 24 }, (_, h) => ({ hour: h, probability: h >= 14 && h <= 15 ? 70 : 10, mm: 0, rainy: h >= 14 && h <= 15 }));

const renderPage = () => render(
  <MemoryRouter initialEntries={[`/planner/${PLAN}/today`]}>
    <Routes><Route path="/planner/:planId/today" element={<TodayPage />} /></Routes>
  </MemoryRouter>,
);

describe('TodayPage 旅帖ライブ (Gate TDay)', () => {
  beforeEach(async () => {
    await clearSnapshots();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    window.localStorage.clear();
    window.sessionStorage.clear();
    Object.values(m).forEach((f) => f.mockClear());
    m.getToday.mockResolvedValue(today());
    m.getTodayGuide.mockResolvedValue(guide());
    m.getWeather.mockResolvedValue({ enabled: true, notice: '', forecasts: [{ date: '2026-11-13', day_id: 'day-1', label: '晴れ',
      weather_code: 1, precipitation_probability: 70, precipitation_mm: 2, temp_max: 18, temp_min: 9, rainy: true, source: 'Open-Meteo',
      has_rain_variant: true, hours, affected_events: [{ event_id: 'f', title: '三尾神社', time: '15:45', probability: 70, fit: 'outdoor' }] }] });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('ライブ帯・旅の糸・出発の合図(出る時刻と段階・概算の明記)を出す', async () => {
    renderPage();
    const band = await screen.findByTestId('today-live-band');
    await waitFor(() => expect(band).toHaveTextContent('あと18分で出発'));
    expect(band).toHaveTextContent('移動 約12分(概算)');
    await waitFor(() => expect(band).toHaveTextContent('14〜16時に雨の可能性 70%'));
    const go = within(screen.getByTestId('today-next')).getByTestId('today-go');
    expect(go).toHaveAttribute('data-stage', 'soon');
    expect(within(go).getByText('12:18 に出れば、ちょうど')).toBeInTheDocument();
    expect(within(go).getByText('移動時間は直線距離からの概算です')).toBeInTheDocument();
    expect(within(go).getByText('そろそろ').closest('li')).toHaveAttribute('aria-current', 'step');
    const thread = screen.getByRole('navigation', { name: '旅の糸(今日の道のり)' });
    expect(within(thread).getByRole('listitem', { name: '10:30 大津駅(印を押した)' })).toBeInTheDocument();
    expect(within(thread).getByRole('listitem', { name: '11:00 浜大津の湖岸(今いる場所)' })).toBeInTheDocument();
    expect(within(thread).getByRole('listitem', { name: '15:45 三尾神社(雨の時間)' })).toBeInTheDocument();
    expect(screen.getByText('DAY 1 / 2', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('湖のまち、大津をめぐる日')).toBeInTheDocument();
  });

  it('次の場所のチラ見せ(営業・予約・電話)と空模様(雨にかかる屋外の予定→プランB)', async () => {
    renderPage();
    const teaser = await screen.findByTestId('today-teaser');
    expect(within(teaser).getByText('営業中')).toBeInTheDocument();
    expect(within(teaser).getByText('予約 あり')).toBeInTheDocument();
    expect(within(teaser).getByRole('link', { name: /電話/ })).toHaveAttribute('href', 'tel:0770000000');
    const sky = await screen.findByTestId('today-sky');
    expect(await within(sky).findByText('15:45 三尾神社(屋外)が雨の時間にかかります。')).toBeInTheDocument();
    expect(within(sky).getByRole('listitem', { name: '14時 70% 雨' })).toBeInTheDocument();
  });

  it('寄り道チャンス: 押した時だけ探し、足す前に後の予定への影響を出して、承認で旅程に足す', async () => {
    m.findDetours.mockResolvedValue({ kind: 'cafe', region: null, message: null, candidates: [
      { name: '湖のカフェ', address: '大津市', latitude: 35.01, longitude: 135.86, distance_km: 0.3, genre_label: 'カフェ',
        category: 'dining', provider: 'openstreetmap', url: null, fit: 'indoor' }] });
    renderPage();
    const box = await screen.findByTestId('today-detour');
    expect(within(box).getByText('14:55〜15:40 に45分の空き')).toBeInTheDocument();
    expect(m.findDetours).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: 'カフェ' }));
    expect(await within(box).findByText('湖のカフェ')).toBeInTheDocument();
    expect(m.findDetours).toHaveBeenCalledWith(PLAN, { after_event_id: 'd', before_event_id: 'f', kind: 'cafe' });
    fireEvent.click(within(box).getByRole('button', { name: '湖のカフェを足す前に影響を見る' }));
    const impact = within(box).getByRole('region', { name: '足す前の影響' });
    expect(impact).toHaveTextContent('寄る時間: 15:00〜15:30');
    expect(impact).toHaveTextContent('三尾神社: 変わらず(あと5分の余裕)');
    fireEvent.click(within(impact).getByRole('radio', { name: '45分' }));
    expect(impact).toHaveTextContent('三尾神社: 10分はみ出します');
    fireEvent.click(within(impact).getByRole('radio', { name: '20分' }));
    fireEvent.click(within(impact).getByRole('button', { name: '今日の旅程に足す' }));
    await waitFor(() => expect(m.addDetourEvent).toHaveBeenCalledWith(PLAN, expect.objectContaining({
      day_id: 'day-1', title: '湖のカフェ', local_start_time: '15:00', local_end_time: '15:20' })));
  });

  it('旅帖: 今いる場所で印を押し、ひとことを綴じる(自分だけが既定)', async () => {
    renderPage();
    const now = await screen.findByTestId('today-now');
    fireEvent.click(within(now).getByRole('button', { name: /着いた・印を押す/ }));
    const dialog = await screen.findByTestId('today-stamp-dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: '着いた・印を押す' }));
    await waitFor(() => expect(m.pressStamp).toHaveBeenCalledWith(PLAN, 'b', expect.any(String), null));
    fireEvent.change(screen.getByLabelText('ひとこと'), { target: { value: '湖が近い' } });
    fireEvent.click(screen.getByRole('button', { name: 'ひとことを綴じる' }));
    await waitFor(() => expect(m.addNote).toHaveBeenCalledWith(PLAN, expect.objectContaining({
      event_id: 'b', day_id: 'day-1', body: '湖が近い', visibility: 'private' })));
    const strip = screen.getByTestId('today-tabicho');
    expect(strip).toHaveTextContent('1 / 5 押印');
  });

  it('画面の中の知らせ(出発・着きましたか)は閉じると同じ日に二度出ない', async () => {
    const first = renderPage();
    const notices = await screen.findByTestId('today-notices');
    await waitFor(() => expect(notices).toHaveTextContent('そろそろ出発の時間'));
    expect(notices).toHaveTextContent('着きましたか?');
    fireEvent.click(within(notices).getByRole('button', { name: '「そろそろ出発の時間」を閉じる' }));
    expect(screen.getByTestId('today-notices')).not.toHaveTextContent('そろそろ出発の時間');
    first.unmount();
    renderPage();
    const again = await screen.findByTestId('today-notices');
    expect(again).not.toHaveTextContent('そろそろ出発の時間');
  });

  it('お助け・移動モード', async () => {
    renderPage();
    await screen.findByTestId('today-next');
    fireEvent.click(screen.getByRole('button', { name: 'お助け' }));
    const help = await screen.findByTestId('today-help');
    expect(within(help).getByText('遅れた・休みだった')).toBeInTheDocument();
    expect(within(help).getByText('テラスでランチに電話')).toBeInTheDocument();
    fireEvent.click(within(help).getByText('移動モード'));
    const transit = await screen.findByTestId('today-transit');
    await waitFor(() => expect(transit).toHaveTextContent('あと30分'));
    expect(transit).toHaveTextContent('12:30 着の見込み');
    fireEvent.click(within(transit).getByRole('button', { name: '終える' }));
    expect(screen.queryByTestId('today-transit')).toBeNull();
  });

  it('旅の前は残りの日数と最初の予定を出す', async () => {
    m.getToday.mockResolvedValue(today({ today_date: null, now_event: null, next_event: null, events: [], minutes_until_next: null, day_end_at: null }));
    m.getTodayGuide.mockResolvedValue(guide({ day_id: null, local_date: null, upcoming: { date: '2026-11-14', days_until: 1,
      day_title: '湖のまち', is_trip_start: true, first_event_title: '自宅を出発', first_event_time: '08:00' }, events: {}, gaps: [], stamps: {} }));
    renderPage();
    const before = await screen.findByTestId('today-before');
    expect(before).toHaveTextContent('あと 1日');
    expect(before).toHaveTextContent('最初の予定: 08:00 自宅を出発');
  });

  it('夜は今日のふりかえりと明日のチラ見せ。最終日は旅の終わり', async () => {
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z')); // 21:00 JST・全部済んだ後
    m.getToday.mockResolvedValue(today({ server_time: '2026-11-13T12:00:00Z', now_event: null, next_event: null,
      events: events.map((x) => ({ ...x, end_at: '2026-11-13T09:00:00Z' })) as never }));
    const first = renderPage();
    const recap = await screen.findByTestId('today-recap');
    expect(recap).toHaveTextContent('今日のふりかえり');
    expect(recap).toHaveTextContent('5か所のうち1か所をめぐりました');
    expect(recap).toHaveTextContent('最初は 09:30 石山寺');
    first.unmount();
    window.sessionStorage.clear();
    m.getTodayGuide.mockResolvedValue(guide({ is_last_day: true }));
    renderPage();
    expect(await screen.findByText('おかえりなさい。旅帖が一冊になりました')).toBeInTheDocument();
  });
});
