/**
 * [Gate PlanSpotEdit] 旅程のスポットの編集(課題一覧 #3)の画面の試験。
 * ① スポットだけを入れ替える案の見え方(keepSlots) ② 区間の操作は印のボタン・「○○から」を出さない
 * ③ 写真のドラッグ&ドロップ・ファイルの選択 ⑧ 予約・費用の要約(読むだけ) ⑨ 場所を選ぶと足りない情報を調べて空の欄にだけ入れる
 * ⑪ 「この日程を削除」は日のカードの上 ⑬ 追加のボタンの名前
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';

const m = vi.hoisted(() => ({
  getReservations: vi.fn(), getExpenses: vi.fn(), uploadMemory: vi.fn(), setEventImage: vi.fn(), getPlaceInfo: vi.fn(),
  addNewScheduleItem: vi.fn(), getHoursCheck: vi.fn(),
}));
vi.mock('@/services/api', async (orig) => ({
  ...(await orig<typeof import('@/services/api')>()),
  getReservations: m.getReservations, getExpenses: m.getExpenses, uploadMemory: m.uploadMemory,
}));
vi.mock('@/services/api/g11discover', () => ({
  getEventImages: vi.fn().mockResolvedValue({}), getEventImageMedia: vi.fn(), getMediaProviderStatus: vi.fn().mockResolvedValue({ image_providers: [] }),
  setEventImage: m.setEventImage, clearEventImage: vi.fn(),
}));
vi.mock('@/services/api/planEdit', () => ({ getPlaceInfo: m.getPlaceInfo, reorderDay: vi.fn() }));
vi.mock('@/services/api/g11planner', () => ({ getHoursCheck: m.getHoursCheck }));
vi.mock('@/services/api/g11', () => ({ getPlanCover: vi.fn().mockResolvedValue({ cover: null, can_edit: false }) }));
vi.mock('@/hooks/usePlan', () => ({
  usePlan: () => ({ addNewScheduleItem: m.addNewScheduleItem, deleteScheduleItem: vi.fn(), reorderSpots: vi.fn() }),
}));
vi.mock('@/components/common/toastContext', () => ({ useToast: () => ({ addToast: vi.fn() }) }));
// 場所を探す部品の代わり: 押すと「鳥羽水族館」(住所・電話なし)を選ぶ
vi.mock('@/components/search/PlaceFinder', () => ({
  default: ({ onPick }: { onPick: (d: unknown) => void }) => (
    <button type="button" onClick={() => onPick({ name: '鳥羽水族館', address: null, latitude: 34.48, longitude: 136.84,
      category: null, description: null, sourceUrl: null })}>候補を選ぶ</button>
  ),
}));

import { keepSlots } from './plannerModel';
import EventRelatedSummary from './EventRelatedSummary';
import EventPhotoDrop from './EventPhotoDrop';
import SegmentPicker from './SegmentPicker';
import DayView from '@/components/DayView';
import type { TravelSegment } from '@/services/api/types/segments';
import type { DaySchedule } from '@/types';

const seg = (over: Partial<TravelSegment>): TravelSegment => ({
  id: 's1', plan_id: 'p', from_event_id: 'a', from_place_id: null, to_event_id: 'b', to_place_id: null, mode: 'train',
  status: 'planned', planned_departure_at: null, planned_arrival_at: null, distance_km: 1, duration_minutes: 10,
  cost: null, currency: null, preparation_minutes: 0, buffer_before_minutes: 0, buffer_after_minutes: 0,
  transport_number: null, platform: null, transfer_count: null, luggage_note: null, reservation_id: null, is_estimate: true,
  provider: 'haversine_estimate', algorithm_version: 'v1', computed_at: null, recommended_departure_at: null, revision: 1,
  created_at: '2026-11-06T00:00:00Z', updated_at: null, ...over,
} as TravelSegment);

beforeEach(() => {
  Object.values(m).forEach((f) => f.mockReset());
  m.getHoursCheck.mockRejectedValue(new Error('offline'));
});

describe('① keepSlots(スポットだけを入れ替える)', () => {
  const evs = [
    { id: 'a', start_time: '09:00', end_time: '10:30', end_day_offset: 0 },
    { id: 'b', start_time: '11:00', end_time: '11:30', end_day_offset: 0 },
    { id: 'c', start_time: '12:00', end_time: '13:00', end_day_offset: 0 },
  ];
  it('位置 i の予定は元の位置 i の時刻を受け継ぎ、区間の端も同じ位置の予定へ付け替える(移動手段は変えない)', () => {
    const segs = [seg({ id: 's1', from_event_id: 'a', to_event_id: 'b', mode: 'train' }),
      seg({ id: 's2', from_event_id: 'b', to_event_id: 'c', mode: 'driving' }),
      seg({ id: 's3', from_event_id: 'c', to_event_id: 'next-day', mode: 'bus' })];
    const r = keepSlots(evs, ['c', 'b', 'a'], segs);
    expect(r.events.map((e) => [e.id, e.start_time, e.end_time])).toEqual([['c', '09:00', '10:30'], ['b', '11:00', '11:30'], ['a', '12:00', '13:00']]);
    expect(r.segments.map((s) => [s.id, s.from_event_id, s.to_event_id, s.mode])).toEqual([
      ['s1', 'c', 'b', 'train'], ['s2', 'b', 'a', 'driving'], ['s3', 'a', 'next-day', 'bus']]);
  });
  it('並びが合わなければ何も変えない', () => {
    expect(keepSlots(evs, ['a', 'b'], []).events).toEqual(evs);
  });
});

describe('② 区間の操作', () => {
  it('移動手段を変える・詳細は印のボタン(名前と吹き出しで意味を伝える)。予定の操作の印とは違う見た目', () => {
    render(<MemoryRouter><SegmentPicker planId="p" revision={1} fromEventId="a" fromTitle="ミキモト真珠島" toEventId="b" toTitle="賀多神社"
      segment={seg({})} mismatch={false} canEdit onSaved={vi.fn()}><span>鉄道</span></SegmentPicker></MemoryRouter>);
    const change = screen.getByTestId('segment-choose-b');
    expect(change).toHaveAccessibleName('「ミキモト真珠島」から「賀多神社」への移動手段を変える');
    expect(change).toHaveAttribute('title', '移動手段を変える');
    expect(change).toHaveClass('tc-seg-iconbtn');
    expect(change.textContent).toBe('');
    const detail = screen.getByTestId('segment-detail-b');
    expect(detail).toHaveClass('tc-seg-iconbtn');
    expect(detail.getAttribute('title')).toContain('移動の詳細');
  });
});

describe('③ 写真のドラッグ&ドロップ・ファイルの選択', () => {
  it('落とした写真を「自分だけ」・旅行記に入れない記録として取り込み、予定の写真にする', async () => {
    m.uploadMemory.mockResolvedValue({ id: 'mem-1' });
    m.setEventImage.mockResolvedValue({ image: { memory_id: 'mem-1', source: null } });
    const onUploaded = vi.fn();
    render(<EventPhotoDrop planId="p" eventId="e1" eventTitle="ミキモト真珠島" onUploaded={onUploaded} />);
    const file = new File(['x'], 'pearl.jpg', { type: 'image/jpeg' });
    fireEvent.drop(screen.getByTestId('event-photo-drop'), { dataTransfer: { files: [file] } });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ memory_id: 'mem-1', source: null }));
    expect(m.uploadMemory).toHaveBeenCalledWith('p', expect.objectContaining({
      kind: 'photo', file, event_id: 'e1', visibility: 'private', include_in_journal: false,
    }));
    expect(m.setEventImage).toHaveBeenCalledWith('p', 'e1', 'mem-1');
  });
  it('ファイルを選んでも入れられる。画像でなければ送らずに理由を出す', async () => {
    render(<EventPhotoDrop planId="p" eventId="e1" eventTitle="x" onUploaded={vi.fn()} />);
    fireEvent.change(screen.getByTestId('event-photo-file'), { target: { files: [new File(['x'], 'a.pdf', { type: 'application/pdf' })] } });
    expect(await screen.findByRole('alert')).toHaveTextContent('JPEG・PNG・WebP');
    expect(m.uploadMemory).not.toHaveBeenCalled();
  });
  it('[PhotoPaste] Ctrl+V・貼り付けの欄でクリップボードの画像を取り込む。文字だけの時は案内する', async () => {
    m.uploadMemory.mockReset().mockResolvedValue({ id: 'mem-2' });
    m.setEventImage.mockReset().mockResolvedValue({ image: { memory_id: 'mem-2', source: null } });
    const onUploaded = vi.fn();
    render(<EventPhotoDrop planId="p" eventId="e1" eventTitle="鳥羽城" onUploaded={onUploaded} />);
    const blob = new File(['png'], 'image.png', { type: 'image/png' });
    const clip = (file: File | null, types: string[] = []) => ({
      items: file ? [{ kind: 'file', type: file.type, getAsFile: () => file }] : [], files: file ? [file] : [], types,
    });
    // 画面のどこでも(document)Ctrl+V
    const ev = new Event('paste', { bubbles: true, cancelable: true }) as Event & { clipboardData: unknown };
    ev.clipboardData = clip(blob, ['Files']);
    act(() => { document.body.dispatchEvent(ev); });
    await waitFor(() => expect(onUploaded).toHaveBeenCalledWith({ memory_id: 'mem-2', source: null }));
    const sent = m.uploadMemory.mock.calls[0]![1].file as File;
    expect(sent.type).toBe('image/png');
    expect(sent.name).toMatch(/^clipboard-\d{14}\.png$/);
    expect(ev.defaultPrevented).toBe(true);
    // 貼り付けの欄(スマホの長押し)。文字(画像の URL)だけなら送らずに案内
    fireEvent.paste(screen.getByTestId('event-photo-paste-field'), { clipboardData: clip(null, ['text/plain']) });
    expect(await screen.findByTestId('event-photo-paste-note')).toHaveTextContent('画像をコピー');
    expect(m.uploadMemory).toHaveBeenCalledTimes(1);
  });
  it('[PhotoPaste] 押しボタンは、ブラウザが読ませない時(http)は Ctrl+V を案内する', async () => {
    render(<EventPhotoDrop planId="p" eventId="e1" eventTitle="x" onUploaded={vi.fn()} />);
    fireEvent.click(screen.getByTestId('event-photo-paste-button'));
    expect(await screen.findByTestId('event-photo-paste-note')).toHaveTextContent('Ctrl+V');
  });
});

describe('⑧ 予約・費用の要約(読むだけ)', () => {
  it('この予定の予約と、予定・その予約に結び付いた費用だけを出す(予約番号は出さない)', async () => {
    m.getReservations.mockResolvedValue([
      { id: 'r1', event_id: 'e1', type: 'admission', status: 'confirmed', provider_name: 'ミキモト真珠島', confirmation_number_masked: '****1234',
        start_at: '2026-11-28T00:00:00Z', end_at: null, total_amount: 3000, currency: 'JPY' },
      { id: 'r2', event_id: 'other', type: 'accommodation', status: 'confirmed', provider_name: '別の宿', start_at: null, end_at: null,
        total_amount: 20000, currency: 'JPY' },
    ]);
    m.getExpenses.mockResolvedValue([
      { id: 'x1', kind: 'expense', title: '入場料', amount: '3000', currency: 'JPY', related_type: 'reservation', related_id: 'r1' },
      { id: 'x2', kind: 'expense', title: 'お土産', amount: '1500', currency: 'JPY', related_type: 'event', related_id: 'e1' },
      { id: 'x3', kind: 'expense', title: '別の費用', amount: '999', currency: 'JPY', related_type: 'event', related_id: 'other' },
    ]);
    render(<MemoryRouter><EventRelatedSummary planId="p" eventId="e1" /></MemoryRouter>);
    const box = await screen.findByTestId('event-related');
    expect(within(box).getByRole('list', { name: '予約' })).toHaveTextContent('入場・ミキモト真珠島(11/28)');
    expect(box).toHaveTextContent('確定・¥3,000');
    expect(box).not.toHaveTextContent('1234');
    expect(box).not.toHaveTextContent('別の宿');
    expect(within(box).getByRole('list', { name: '費用' })).toHaveTextContent('入場料');
    expect(box).toHaveTextContent('お土産');
    expect(box).not.toHaveTextContent('別の費用');
    expect(box).toHaveTextContent('費用の合計(円)¥4,500');
    expect(box.querySelector('input, textarea, select')).toBeNull();
  });
  it('結び付いた物が無い・読めない時は何も出さない', async () => {
    m.getReservations.mockRejectedValue(new Error('x'));
    m.getExpenses.mockResolvedValue([]);
    const { container } = render(<MemoryRouter><EventRelatedSummary planId="p" eventId="e1" /></MemoryRouter>);
    await waitFor(() => expect(m.getExpenses).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });
});

describe('DayView の日のカード', () => {
  const day = (): DaySchedule => ({ id: 'd2', date: '2026-11-29', timezone_id: 'Asia/Tokyo', events: [
    { id: 'e1', title: '伊射波神社', category: 'sightseeing' },
  ] });

  it('⑪ 「この日程を削除」は日のカードの上(どの日か読み上げる)。⑬ 追加のボタンは日の見出しの右の「＋ 予定を追加」', async () => {
    const onDeleteDay = vi.fn();
    render(<DayView day={day()} planId="p1" onDeleteDay={onDeleteDay} />);
    const del = screen.getByTestId('day-delete');
    expect(del).toHaveTextContent('この日程を削除');
    expect(del).toHaveAccessibleName('2026-11-29 (日)の日程を削除');
    fireEvent.click(del);
    expect(onDeleteDay).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: '＋ 予定を追加' })).toBeInTheDocument();
    expect(screen.queryByText(/日程に追加する/)).toBeNull();
    await waitFor(() => expect(m.getHoursCheck).not.toHaveBeenCalled());
  });

  it('日が 1 つの時(削除を渡さない)は「この日程を削除」を出さない', async () => {
    render(<DayView day={day()} planId="p1" />);
    expect(screen.queryByTestId('day-delete')).toBeNull();
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
  });

  it('⑨ 場所を選ぶと、足りない住所・電話番号・種類を 1 回だけ調べて空の欄に入れ、出典を示す。電話番号も送る', async () => {
    m.getPlaceInfo.mockResolvedValue({
      provider: 'nominatim', attribution: '© OpenStreetMap contributors', license: 'ODbL 1.0', license_url: 'https://www.openstreetmap.org/copyright',
      cached: false, unavailable: false, error_code: null,
      candidates: [{ name: '鳥羽水族館', address: '〒517-8517 三重県鳥羽市鳥羽3丁目3-6', phone: '0599-25-2555', website: null,
        category: 'activity', osm_type: 'aquarium', latitude: 34.48, longitude: 136.84, source_url: null }],
    });
    m.addNewScheduleItem.mockResolvedValue(undefined);
    render(<DayView day={day()} planId="p1" />);
    fireEvent.click(screen.getByRole('button', { name: '＋ 予定を追加' }));
    fireEvent.click(await screen.findByRole('button', { name: '候補を選ぶ' }));
    await waitFor(() => expect(screen.getByLabelText('場所・住所')).toHaveValue('〒517-8517 三重県鳥羽市鳥羽3丁目3-6'));
    expect(m.getPlaceInfo).toHaveBeenCalledTimes(1);
    expect(m.getPlaceInfo).toHaveBeenCalledWith(expect.objectContaining({ name: '鳥羽水族館', latitude: 34.48, longitude: 136.84 }));
    expect(screen.getByLabelText('電話番号')).toHaveValue('0599-25-2555');
    expect(screen.getByTestId('new-lookup-note')).toHaveTextContent('自動取得で住所・電話');
    fireEvent.click(screen.getByRole('button', { name: '追加' }));
    await waitFor(() => expect(m.addNewScheduleItem).toHaveBeenCalledWith('p1', 'd2', expect.objectContaining({
      title: '鳥羽水族館', address: '〒517-8517 三重県鳥羽市鳥羽3丁目3-6', phone: '0599-25-2555', category: 'activity',
    })));
  });
});
