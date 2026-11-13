/**
 * [Gate SpotLinks] 予定の編集の窓: URL(初め 1 行・＋で 5 件まで)・形の確かめ・地図の位置(住所から探す・印を動かす)。
 * 準備は PlannerPage.collab.test.tsx と同じ。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ScheduleItem } from '@/types';

// [Gate Remaining-2] 祝日は取りに行かない(外の通信を差し替える)
vi.mock('@/hooks/usePlanHolidays', () => ({ usePlanHolidays: () => ({}) }));
vi.mock('@/components/planner/variants/usePlanVariants', () => ({
  usePlanVariants: () => ({ canEdit: false, variants: [], openId: null, setOpenId: () => {}, open: null, checkSum: null,
    reload: () => {}, datesWithStandby: [] }),
}));
vi.mock('@/components/planner/variants/VariantPanel', () => ({ default: () => null }));
vi.mock('@/components/PlanHeader', () => ({ default: () => null }));
vi.mock('@/components/planning/PlanningUsageMeter', () => ({ default: () => null }));
vi.mock('@/components/planner/DateNavigation', () => ({ default: () => null }));
vi.mock('@/components/planner/OptimizationPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/PlanMap', () => ({ default: () => null }));
// [Gate PlanSpotEdit] 編集の画面の写真・予約と費用の要約は、それぞれの試験で確かめる
vi.mock('@/components/planner/EventPhotoPanel', () => ({ default: () => null }));
vi.mock('@/components/planner/EventRelatedSummary', () => ({ default: () => null }));
// [Gate SpotLinks] 編集の窓の地図(Leaflet)は位置と、印を動かした時の通知だけを確かめる
vi.mock('@/components/planner/SpotMiniMap', () => ({
  default: ({ latitude, longitude, onMove }: { latitude: number; longitude: number; onMove?: (a: number, b: number) => void }) => (
    <div data-testid="spot-mini-map" data-at={`${latitude},${longitude}`}>
      <button type="button" onClick={() => onMove?.(35.0001, 135.7801)}>印を動かす</button>
    </div>
  ),
}));
const { getPlaceInfo, geocodeAddress } = vi.hoisted(() => ({ getPlaceInfo: vi.fn(), geocodeAddress: vi.fn() }));
vi.mock('@/services/api/planEdit', () => ({ getPlaceInfo, geocodeAddress, reorderDay: vi.fn() }));
vi.mock('@/components/DayView', () => ({
  default: ({ day, onItemEdit }: { day: { events: ScheduleItem[] }; onItemEdit: (i: ScheduleItem) => void }) => (
    <div>{day.events.map((e) => <button key={e.id} type="button" onClick={() => onItemEdit(e)}>編集: {e.title}</button>)}</div>
  ),
}));

import PlannerPage from './PlannerPage';
import { ToastProvider } from '@/components/common/Toast';
import { usePlanStore } from '@/store/planStore';
import { useAuthStore } from '@/store/authStore';
import { api } from '@/services/api';
import type { TravelPlan } from '@/types';
// [Gate BookingBadge] 予約の札の読み込み(旅程の予定ごと)は空にする
vi.mock('@/services/api/bookingStatus', () => ({
  getBookingStatus: vi.fn().mockResolvedValue({ party_size: null, events: {} }), linkReservationToEvent: vi.fn(),
}));


const plan = (title: string, revision: number, notes?: string): TravelPlan => ({
  id: 'plan-1', title: 'trip', revision,
  days: [{ id: 'd1', date: '2026-11-02', events: [{ id: 'e1', title, category: 'sightseeing', start_time: '10:00', description: notes }] }],
}) as unknown as TravelPlan;

function setup() {
  const updateScheduleItem = vi.fn();
  const loadPlan = vi.fn().mockResolvedValue(true);
  usePlanStore.setState({
    plans: [], currentPlan: plan('清水寺', 3), currentDayIndex: 0, isLoading: false, isOfflineData: false,
    loadPlan, loadPlans: vi.fn(), clearCurrentPlan: vi.fn(),
    checkOfflineAvailability: vi.fn().mockResolvedValue(false), updateScheduleItem,
  });
  useAuthStore.setState({ isAuthenticated: true, isGuest: false });
  vi.spyOn(api, 'getRoutePreview').mockResolvedValue({ legs: [] } as unknown as Awaited<ReturnType<typeof api.getRoutePreview>>);
  vi.spyOn(api, 'leavePresence').mockResolvedValue(undefined);
  vi.spyOn(api, 'getSegments').mockResolvedValue([]);  // [Gate G11] 予定へ着く移動区間
  // [Gate G2] 即時の通知は使わない(ポーリングだけ)。同行者向けの項目の規則: 何も隠されていない
  vi.spyOn(api, 'streamPlanEvents').mockResolvedValue('unsupported');
  vi.spyOn(api, 'getMemberPolicy').mockResolvedValue({
    plan_id: 'plan-1', role: 'owner', my_hidden: [], catalog: { version: 1, categories: [], presets: {} },
  });
  vi.spyOn(api, 'postPresence').mockResolvedValue({
    plan_id: 'plan-1', revision: 4, poll_seconds: 5, ttl_seconds: 40,
    viewers: [
      { user_id: 'a', label: 'あなた', role: 'owner', is_self: true, devices: 1, seen_at: '', editing: null },
      { user_id: 'b', label: 'hana', role: 'editor', is_self: false, devices: 1, seen_at: '',
        editing: { kind: 'event', id: 'e1', label: '清水寺' } },
    ],
    changes: [{ revision: 4, actor_label: 'hana', is_self: false, source: 'manual', undone: false, count: 1,
      items: [{ entity_type: 'travel_event', action: 'update', label: '清水寺(朝)' }], at: null }],
  });
  render(
    <ToastProvider>
      <MemoryRouter initialEntries={['/planner/plan-1']}>
        <Routes><Route path="/planner/:planId" element={<PlannerPage />} /></Routes>
      </MemoryRouter>
    </ToastProvider>,
  );
  return { updateScheduleItem, loadPlan };
}

describe('PlannerPage スポットの URL と地図 (Gate SpotLinks)', () => {
  afterEach(() => {
    // [Gate G3] DEP-04 差し替えを戻す前に閉じる(閉じる時の知らせが本物の通信にならない)
    cleanup();
    vi.restoreAllMocks();
  });

  it('[SpotLinks] URL は初め 1 行・「URL を追加」で 5 件まで。形の違う URL は保存しない。変えた URL と位置を送る', async () => {
    const { updateScheduleItem } = setup();
    getPlaceInfo.mockReset().mockResolvedValue({
      provider: 'nominatim', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', license_url: '',
      cached: false, unavailable: false, error_code: null,
      candidates: [{ name: '清水寺', address: '京都府京都市東山区清水', phone: null, website: null, category: null,
        osm_type: null, latitude: 34.9949, longitude: 135.785, source_url: null }],
    });
    geocodeAddress.mockReset().mockResolvedValue({ unavailable: false,
      sources: [{ provider: 'gsi', label: '国土地理院', credit: '国土地理院 住所検索・逆ジオコーダ', url: 'https://www.gsi.go.jp/' }],
      candidates: [{ address: '京都府京都市東山区清水', latitude: 34.9949, longitude: 135.785, provider: 'gsi', level: null }] });
    fireEvent.click(await screen.findByRole('button', { name: '編集: 清水寺' }));
    expect(screen.getAllByLabelText(/^URL \d$/)).toHaveLength(1);
    expect(screen.getByTestId('edit-map-empty')).toBeInTheDocument();  // 位置が無ければ地図の代わりに案内
    for (let i = 0; i < 4; i += 1) fireEvent.click(screen.getByTestId('event-url-add'));
    expect(screen.getAllByLabelText(/^URL \d$/)).toHaveLength(5);
    expect(screen.queryByTestId('event-url-add')).toBeNull();  // 5 件まで
    fireEvent.click(screen.getByRole('button', { name: 'URL 5 を消す' }));
    expect(screen.getAllByLabelText(/^URL \d$/)).toHaveLength(4);
    fireEvent.change(screen.getByLabelText('URL 1'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('URL の形ではありません');
    expect(updateScheduleItem).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText('URL 1'), { target: { value: 'https://www.kiyomizudera.or.jp/' } });
    fireEvent.change(screen.getByLabelText('URL 2'), { target: { value: 'https://www.kiyomizudera.or.jp/' } });
    // 住所から位置を探して選ぶと、街の縮尺の地図が出る。印を動かすと位置が変わる
    fireEvent.change(screen.getByLabelText('場所・住所'), { target: { value: '京都府京都市東山区清水' } });
    fireEvent.click(screen.getByTestId('edit-map-lookup'));
    // [PlaceLookupJP] 住所がある時は住所の検索(Yahoo!・国土地理院)で探す
    expect(geocodeAddress).toHaveBeenLastCalledWith('京都府京都市東山区清水', expect.anything());
    expect(getPlaceInfo).not.toHaveBeenCalled();
    expect(await screen.findByTestId('place-sources')).toHaveTextContent('国土地理院');
    fireEvent.click(within(await screen.findByTestId('place-info-result')).getByRole('button', { name: 'この位置にする' }));
    expect(await screen.findByTestId('spot-mini-map')).toHaveAttribute('data-at', '34.9949,135.785');
    fireEvent.click(screen.getByRole('button', { name: '印を動かす' }));
    expect(screen.getByTestId('edit-map-note')).toHaveTextContent('位置を変えました');
    updateScheduleItem.mockResolvedValueOnce('saved');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalledTimes(1));
    expect(updateScheduleItem.mock.calls[0]![1]).toMatchObject({
      urls: [{ url: 'https://www.kiyomizudera.or.jp/', label: null }], latitude: 35.0001, longitude: 135.7801,
    });
  });

  it('[SpotLinks] URL も位置も変えなければ送らない', async () => {
    const { updateScheduleItem } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 清水寺' }));
    updateScheduleItem.mockResolvedValueOnce('saved');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalledTimes(1));
    expect(updateScheduleItem.mock.calls[0]![1]).not.toHaveProperty('urls');
    expect(updateScheduleItem.mock.calls[0]![1]).not.toHaveProperty('latitude');
  });

  it('[SpotInfo] 種類が「食事」の時は食事の情報を入れられ、変えた時だけ送る', async () => {
    const { updateScheduleItem } = setup();
    fireEvent.click(await screen.findByRole('button', { name: '編集: 清水寺' }));
    expect(screen.queryByTestId('dining-fields')).toBeNull();
    fireEvent.change(screen.getByTestId('edit-category'), { target: { value: 'dining' } });
    const fields = screen.getByTestId('dining-fields');
    fireEvent.click(within(fields).getByTestId('dining-genre-washoku'));
    fireEvent.change(within(fields).getByLabelText('予算(昼・1 人)'), { target: { value: '2000_3000' } });
    fireEvent.change(within(fields).getByLabelText('駐車場'), { target: { value: 'nearby' } });
    updateScheduleItem.mockResolvedValueOnce('saved');
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(updateScheduleItem).toHaveBeenCalledTimes(1));
    expect(updateScheduleItem.mock.calls[0]![1]).toMatchObject({
      category: 'dining', dining: { genres: ['washoku'], budget_lunch: '2000_3000', parking: 'nearby' },
    });
  });
});
