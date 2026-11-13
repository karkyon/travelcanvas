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
  getAlerts: vi.fn(),
  createAlert: vi.fn(),
  createReplan: vi.fn(),
  getReplan: vi.fn(),
  applyReplan: vi.fn(async () => ({})),
  getPackingItems: vi.fn(async () => []),
}));
vi.mock('@/services/api', () => ({
  getToday: m.getToday, getAlerts: m.getAlerts, createAlert: m.createAlert, createReplan: m.createReplan,
  getReplan: m.getReplan, applyReplan: m.applyReplan, getPackingItems: m.getPackingItems,
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

  /** [Gate TDay-Mock] 開いた画面(後から読む)を待つ */
  const dock = () => screen.getByRole('navigation', { name: '当日の操作' });

  it('ライブ帯・旅の糸・出発の合図(出る時刻と段階・概算の明記)を出す', async () => {
    renderPage();
    const band = await screen.findByTestId('today-live-band', undefined, { timeout: 5000 });
    await waitFor(() => expect(band).toHaveTextContent('あと18分で出発'));
    expect(band).toHaveTextContent('移動 約12分（概算）');
    await waitFor(() => expect(band).toHaveTextContent('14時から雨の可能性 70%'));
    const next = screen.getByTestId('today-next');
    expect(next).toHaveAttribute('data-stage', 'soon');
    expect(next).toHaveTextContent('出発の合図 ・ NEXT');
    expect(next).toHaveTextContent('テラスでランチ 12:30着');
    const go = next;
    expect(within(go).getByText('12:18 に出れば、ちょうど')).toBeInTheDocument();
    expect(within(go).getByText('移動時間は直線距離からの概算です')).toBeInTheDocument();
    expect(within(within(go).getByRole('list', { name: '出発までの段階' })).getByText('そろそろ')).toHaveAttribute('aria-current', 'step');
    const thread = screen.getByRole('navigation', { name: '旅の糸(今日の道のり)' });
    expect(within(thread).getByRole('listitem', { name: '10:30 大津駅(印を押した)' })).toBeInTheDocument();
    expect(within(thread).getByRole('listitem', { name: '11:00 浜大津の湖岸(今いる場所)' })).toBeInTheDocument();
    expect(within(thread).getByRole('listitem', { name: '15:45 三尾神社(雨の時間)' })).toBeInTheDocument();
    expect(screen.getByText('DAY 1 / 2', { exact: false })).toBeInTheDocument();
    expect(screen.getByText('湖のまち、大津をめぐる日')).toBeInTheDocument();
  });

  it('次の場所のチラ見せ(営業・予約・電話)と空模様(雨にかかる屋外の予定→プランB)', async () => {
    renderPage();
    const teaser = await screen.findByTestId('today-teaser', undefined, { timeout: 5000 });
    expect(within(teaser).getByText('営業中')).toBeInTheDocument();
    expect(within(teaser).getByText('予約 あり')).toBeInTheDocument();
    expect(within(teaser).getByRole('link', { name: /電話/ })).toHaveAttribute('href', 'tel:0770000000');
    const sky = await screen.findByTestId('today-sky', undefined, { timeout: 5000 });
    expect(await within(sky).findByText('15:45 三尾神社（屋外）が雨の時間にかかります。')).toBeInTheDocument();
    expect(within(sky).getByRole('listitem', { name: '14時 70% 雨' })).toBeInTheDocument();
    // スマホ・タブレットの「雨の兆し」のカード → 雨の兆しの画面(影響する予定・プランB)
    const rain = await screen.findByTestId('today-rain', undefined, { timeout: 5000 });
    expect(rain).toHaveTextContent('14〜16時 雨 70%');
    expect(rain).toHaveTextContent('15:45 三尾神社（屋外）にかかります');
    fireEvent.click(within(rain).getByRole('button', { name: /プランB/ }));
    const scr = await screen.findByTestId('today-rain-screen', undefined, { timeout: 5000 });
    expect(scr).toHaveTextContent('14〜16時、雨の可能性 70%');
    expect(scr).toHaveTextContent('影響する予定：15:45 三尾神社（屋外）');
  });

  it('寄り道チャンス: 押した時だけ探し、足す前に後の予定への影響を出して、承認で旅程に足す', async () => {
    m.findDetours.mockResolvedValue({ kind: 'cafe', region: null, message: null, candidates: [
      { name: '湖のカフェ', address: '大津市', latitude: 35.01, longitude: 135.86, distance_km: 0.3, genre_label: 'カフェ',
        category: 'dining', provider: 'openstreetmap', url: null, fit: 'indoor' }] });
    renderPage();
    const box = await screen.findByTestId('today-detour', undefined, { timeout: 5000 });
    expect(box).toHaveTextContent('14:55〜15:40 に45分の空き');
    expect(m.findDetours).not.toHaveBeenCalled();
    fireEvent.click(within(box).getByRole('button', { name: '見る' }));
    const scr = await screen.findByTestId('today-detour-screen', undefined, { timeout: 5000 });
    expect(scr).toHaveTextContent('本要寺のあと、45分の空き');
    await waitFor(() => expect(m.findDetours).toHaveBeenCalledWith(PLAN, { after_event_id: 'd', before_event_id: 'f', kind: 'all' }));
    fireEvent.click(within(scr).getByRole('button', { name: 'カフェ' }));
    expect(await within(scr).findByText('湖のカフェ')).toBeInTheDocument();
    expect(m.findDetours).toHaveBeenCalledWith(PLAN, { after_event_id: 'd', before_event_id: 'f', kind: 'cafe' });
    fireEvent.click(within(scr).getByRole('button', { name: '湖のカフェを足す前に影響を見る' }));
    const add = await screen.findByTestId('today-detour-add', undefined, { timeout: 5000 });
    const impact = within(add).getByRole('region', { name: '後の予定への影響' });
    expect(add).toHaveTextContent('本要寺のあと 15:00〜15:30');
    expect(impact).toHaveTextContent('三尾神社15:40 → 15:40 変わらず'.replace('15:40', '15:45').replace('15:40', '15:45'));
    expect(impact).toHaveTextContent('空き時間45分 → 5分');
    fireEvent.click(within(add).getByRole('radio', { name: '45分' }));
    expect(impact).toHaveTextContent('10分はみ出します');
    expect(within(add).getByRole('button', { name: '今日の旅程に足す' })).toBeDisabled();
    fireEvent.click(within(add).getByRole('radio', { name: '20分' }));
    fireEvent.click(within(add).getByRole('button', { name: '今日の旅程に足す' }));
    await waitFor(() => expect(m.addDetourEvent).toHaveBeenCalledWith(PLAN, expect.objectContaining({
      day_id: 'day-1', title: '湖のカフェ', local_start_time: '15:00', local_end_time: '15:20' })));
  });

  it('旅帖: 今いる場所で印を押し、ひとことを綴じる(自分だけが既定)', async () => {
    renderPage();
    const now = await screen.findByTestId('today-now', undefined, { timeout: 5000 });
    expect(now).toHaveTextContent('NOW ・ 残り10分');
    fireEvent.click(within(now).getAllByRole('button', { name: '印を押す' })[0]!);
    const dialog = await screen.findByTestId('today-stamp-dialog', undefined, { timeout: 5000 });
    fireEvent.click(within(dialog).getByRole('button', { name: '着いた・印を押す' }));
    await waitFor(() => expect(m.pressStamp).toHaveBeenCalledWith(PLAN, 'b', expect.any(String), null));
    expect(await within(dialog).findByText('令和八年 十一月十三日')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('今日 2つ目の印 ・ 予定より60分遅れ');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ひとこと' }));
    const memo = await screen.findByTestId('today-memo', undefined, { timeout: 5000 });
    fireEvent.change(within(memo).getByLabelText('ひとこと'), { target: { value: '湖が近い' } });
    expect(within(memo).getByRole('button', { name: '自分だけ' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(memo).getByRole('button', { name: /旅帖に綴じる/ }));
    await waitFor(() => expect(m.addNote).toHaveBeenCalledWith(PLAN, expect.objectContaining({
      event_id: 'b', day_id: 'day-1', body: '湖が近い', visibility: 'private', include_in_journal: true })));
    const strip = screen.getByTestId('today-tabicho');
    expect(strip).toHaveTextContent('1 / 5 押印');
  });

  it('画面の中の知らせ(出発・着きましたか)は閉じると同じ日に二度出ない', async () => {
    const first = renderPage();
    const notices = await screen.findByTestId('today-notices', undefined, { timeout: 5000 });
    await waitFor(() => expect(notices).toHaveTextContent('そろそろ出発の時間'));
    expect(notices).toHaveTextContent('着きましたか?');
    fireEvent.click(within(notices).getByRole('button', { name: '「そろそろ出発の時間」を閉じる' }));
    expect(screen.getByTestId('today-notices')).not.toHaveTextContent('そろそろ出発の時間');
    first.unmount();
    renderPage();
    const again = await screen.findByTestId('today-notices', undefined, { timeout: 5000 });
    expect(again).not.toHaveTextContent('そろそろ出発の時間');
  });

  it('お助け・移動モード', async () => {
    renderPage();
    await screen.findByTestId('today-next', undefined, { timeout: 5000 });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(within(dock()).getByRole('button', { name: 'お助け' }));
    const help = await screen.findByTestId('today-help', undefined, { timeout: 5000 });
    expect(within(help).getByText('遅れた・休みだった')).toBeInTheDocument();
    await waitFor(() => expect(within(help).getByRole('link', { name: /お店・宿に電話/ })).toHaveAttribute('href', 'tel:0770000000'));
    fireEvent.click(within(help).getByRole('button', { name: '閉じる' }));
    await waitFor(() => expect(screen.queryByTestId('today-help')).toBeNull());
    // 出発の合図の画面(段階・出る時刻)→ 案内を開く → 移動モード
    fireEvent.click(within(screen.getByTestId('today-next')).getByRole('button', { name: '案内を開く' }));
    const gonow = await screen.findByTestId('today-gonow', undefined, { timeout: 5000 });
    expect(gonow).toHaveTextContent('段階：そろそろ');
    expect(gonow).toHaveTextContent('そろそろ準備を');
    expect(gonow).toHaveTextContent('12:18 に出ると 12:30 に着きます');
    fireEvent.click(within(gonow).getByRole('button', { name: '案内を開く' }));
    expect(open).toHaveBeenCalled();
    const transit = await screen.findByTestId('today-transit', undefined, { timeout: 5000 });
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
    const before = await screen.findByTestId('today-before', undefined, { timeout: 5000 });
    expect(before).toHaveTextContent('あと 1日');
    expect(before).toHaveTextContent('最初の予定: 08:00 自宅を出発');
  });

  it('夜は今日のふりかえりと明日のチラ見せ。最終日は旅の終わり', async () => {
    vi.setSystemTime(new Date('2026-11-13T12:00:00Z')); // 21:00 JST・全部済んだ後
    m.getToday.mockResolvedValue(today({ server_time: '2026-11-13T12:00:00Z', now_event: null, next_event: null,
      events: events.map((x) => ({ ...x, end_at: '2026-11-13T09:00:00Z' })) as never }));
    const first = renderPage();
    const recap = await screen.findByTestId('today-recap', undefined, { timeout: 5000 });
    expect(recap).toHaveTextContent('今日のふりかえり');
    expect(recap).toHaveTextContent('5か所のうち1か所をめぐりました');
    expect(recap).toHaveTextContent('09:30 出発 ・ 3か所');
    first.unmount();
    window.sessionStorage.clear();
    m.getTodayGuide.mockResolvedValue(guide({ is_last_day: true }));
    renderPage();
    expect(await screen.findByText('おかえりなさい。旅帖が一冊になりました')).toBeInTheDocument();
  });

  it('朝は「おはようございます」と最初の出発・出発前のチェック。「今日の画面へ」で今日の画面に戻る', async () => {
    vi.setSystemTime(new Date('2026-11-13T01:00:00Z')); // 10:00 JST・最初の予定の前
    m.getToday.mockResolvedValue(today({ server_time: '2026-11-13T01:00:00Z', now_event: null, next_event: events[0] as never }));
    m.getTodayGuide.mockResolvedValue(guide({ stamps: {}, events: { ...guide().events,
      a: gEvent('a', { leave_by: '2026-11-13T01:10:00Z', travel_minutes: 20, travel_source: 'estimate' }) } }));
    renderPage();
    const dawn = await screen.findByTestId('today-dawn', undefined, { timeout: 5000 });
    expect(dawn).toHaveTextContent('おはようございます');
    expect(dawn).toHaveTextContent('今日は、湖のまち、大津をめぐる日');
    await waitFor(() => expect(dawn).toHaveTextContent('10:10 に出発'));
    fireEvent.click(within(dawn).getByRole('button', { name: '今日の画面へ' }));
    expect(await screen.findByTestId('today-next', undefined, { timeout: 5000 })).toHaveTextContent('大津駅 10:30着');
    expect(screen.queryByTestId('today-dawn')).toBeNull();
  });

  it('予定の無い日は「今日は自由な日です」と昨日の旅帖', async () => {
    m.getToday.mockResolvedValue(today({ now_event: null, next_event: null, events: [], minutes_until_next: null }));
    m.getTodayGuide.mockResolvedValue(guide({ events: {}, gaps: [], stamps: {}, prev_day: { date: '2026-11-12', title: '京都', visited: 6, photos: 38 } }));
    renderPage();
    const free = await screen.findByTestId('today-free', undefined, { timeout: 5000 });
    expect(free).toHaveTextContent('今日は自由な日です');
    expect(free).toHaveTextContent('11/13（金）の予定はまだありません。');
    await waitFor(() => expect(free).toHaveTextContent('昨日の旅帖： 6つの印 ・ 写真 38枚'));
  });

  it('遅れの知らせ: 知らせて組み直しの案(A/B)を作り、承認した案で組み直す', async () => {
    m.getAlerts.mockResolvedValue({ plan_id: PLAN, server_time: NOW, can_edit: true, alerts: [], detected: [] });
    const alert = { id: 'al1', plan_id: PLAN, kind: 'delay', kind_label: '遅延', source: 'user_report', source_label: null,
      confidence: 'reported', observed_at: NOW, is_stale: false, event_id: 'c', event_title: 'テラスでランチ', event_local_start_time: '12:30',
      event_missing: false, day_id: 'day-1', local_date: '2026-11-13', delay_minutes: 20, note: null, status: 'active', resolved_at: null,
      created_by_name: 'わたし', latest_replan_id: null, latest_replan_status: null, revision: 1, created_at: NOW, updated_at: null };
    m.createAlert.mockResolvedValue(alert);
    const cand = (id: 'A' | 'B', label: string, lost: { event_id: string; title: string }[]) => ({
      id, strategy: id === 'A' ? 'shift_later' : 'remove', label, description: '', available: true, unavailable_reason: null, warnings: [],
      changes: [{ event_id: 'd', title: '本要寺', before_time: '14:15', after_time: '14:35', before_date: '2026-11-13', after_date: '2026-11-13' }],
      lost, protected: [], metrics: { changed_count: 1, lost_count: lost.length, protected_count: 0, max_delay_minutes: 20,
        day_end_shift_minutes: id === 'A' ? 20 : null }, cost_impact: null });
    m.createReplan.mockResolvedValue({ id: 'rp1', plan_id: PLAN, alert_id: 'al1', algorithm_version: 'v1', base_revision: 3, plan_revision: 3,
      is_stale: false, status: 'proposed', state: 'proposed', applied_candidate: null, applied_at: null, applied_by_name: null,
      created_by_name: 'わたし', can_apply: true, candidates: [cand('A', '後ろへずらす', []), cand('B', '一つ外す', [{ event_id: 'f', title: '三尾神社' }])],
      revision: 1, created_at: NOW });
    renderPage();
    await screen.findByTestId('today-next', undefined, { timeout: 5000 });
    fireEvent.click(within(dock()).getByRole('button', { name: 'お助け' }));
    fireEvent.click(within(await screen.findByTestId('today-help', undefined, { timeout: 5000 })).getByRole('button', { name: /遅れた・休みだった/ }));
    const delay = await screen.findByTestId('today-delay', undefined, { timeout: 5000 });
    fireEvent.click(await within(delay).findByRole('button', { name: '組み直しの案を作る' }));
    await waitFor(() => expect(m.createAlert).toHaveBeenCalledWith(PLAN, expect.objectContaining({
      kind: 'delay', event_id: 'c', delay_minutes: 20, source: 'user_report' })));
    expect(await within(delay).findByText('案A 後ろへずらす')).toBeInTheDocument();
    expect(delay).toHaveTextContent('宿に20分遅れ ・ 外す予定なし');
    expect(delay).toHaveTextContent('三尾神社は外れます');
    expect(delay).toHaveTextContent('承認するまで旅程は変わりません');
    fireEvent.click(within(delay).getByRole('button', { name: '案Bにする' }));
    await waitFor(() => expect(m.applyReplan).toHaveBeenCalledWith(PLAN, 'rp1', 'B', 3));
  });
});
