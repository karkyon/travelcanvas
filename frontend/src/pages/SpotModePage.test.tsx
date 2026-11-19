/**
 * [Gate SpotMode] FR-060 スポットモード(SC-49)と自由に歩くエリアの準備(SC-50)の画面の試験。
 * - 予定 ⇄ スポットの切り替え・残り時間と戻り始め・ジャンルで絞る・一覧から選ぶ・着いた・行きたい印
 * - 次どこ？ の気分の札と理由・方角で見る・周りを探す(現在地が要る)
 * - 通信できない時は端末に保存した情報を出す
 * - 準備: 近くにまとまった候補の案 → まとめてエリアにする・優先と滞在・If-Match で直す
 * 地図(Leaflet)は jsdom で描けないので、印を押せる簡単な代わりに置き換える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { SpotArea, SpotItem } from '@/services/api/types/spotAreas';

const m = vi.hoisted(() => ({
  listSpotAreas: vi.fn(), suggestSpotAreas: vi.fn(), createSpotArea: vi.fn(), updateSpotArea: vi.fn(), deleteSpotArea: vi.fn(),
  addSpotItem: vi.fn(), splitOff: vi.fn(), rejoin: vi.fn(), markSpotVisit: vi.fn(), clearSpotVisit: vi.fn(), setSpotWant: vi.fn(), searchNearby: vi.fn(),
  getCandidates: vi.fn(), getPlanDetail: vi.fn(), createCandidate: vi.fn(), saveSnapshot: vi.fn(), loadSnapshot: vi.fn(),
}));

vi.mock('@/services/api/spotAreas', () => ({ ...m }));
vi.mock('@/services/api', async () => {
  const actual = await vi.importActual<typeof import('@/services/api')>('@/services/api');
  return { extractApiErrorDetailMessage: actual.extractApiErrorDetailMessage, getCandidates: m.getCandidates,
    api: { getPlanDetail: m.getPlanDetail, createCandidate: m.createCandidate } };
});
vi.mock('@/utils/offlineVault', () => ({ saveSnapshot: m.saveSnapshot, loadSnapshot: m.loadSnapshot }));
vi.mock('@/utils/offlineSession', () => ({ currentOfflineSession: () => null }));
vi.mock('./spot/SpotLeafletMap', () => ({
  default: ({ items, onSelect, line }: { items: SpotItem[]; onSelect: (id: string) => void; line: unknown }) => (
    <div data-testid="map" data-line={line ? 'on' : 'off'}>
      {items.map((i) => <button key={i.id} type="button" onClick={() => onSelect(i.id)}>印 {i.title}</button>)}
    </div>
  ),
}));

import SpotModePage from './SpotModePage';
import SpotAreasPage from './SpotAreasPage';

const item = (over: Partial<SpotItem>): SpotItem => ({
  id: 'i1', candidate_id: 'c1', title: '赤福 本店', note: '縁台で食べられる', category: null, address: null,
  latitude: 34.4610, longitude: 136.7247, place_id: null, genre: 'food', genre_label: '食べ歩き', priority: 'want',
  stay_minutes: 20, sort_order: 0, visited_at: null, visited_by: null, skipped: false, wanted_by: [], wanted_by_me: false,
  fit: 'unknown', seats: true, hours_today: null, ...over,
});

const AREA: SpotArea = {
  id: 'a1', title: 'おかげ横丁・おはらい町', day_id: 'd1', local_date: '2026-11-29', timezone_id: 'Asia/Tokyo',
  start_time: '13:00', end_time: '15:30', meet_label: '駐車場', meet_time: '15:30', meet_latitude: 34.4640, meet_longitude: 136.7230,
  center_latitude: 34.4615, center_longitude: 136.7246, radius_m: 400, suggest_on_approach: true, revision: 3, can_edit: true,
  splits: [{ name: '太郎', is_me: false, meet_label: '駐車場', meet_time: '15:20', note: null, since: null }],
  items: [
    item({}),
    item({ id: 'i2', candidate_id: 'c2', title: '五十鈴川のカフェ', genre: 'cafe', genre_label: 'カフェ', priority: 'maybe',
      latitude: 34.4605, longitude: 136.7262, fit: 'indoor', sort_order: 1 }),
    item({ id: 'i3', candidate_id: 'c3', title: 'おかげ座', genre: 'sight', genre_label: '見どころ', priority: 'maybe',
      seats: false, latitude: 34.4617, longitude: 136.7240, sort_order: 2, visited_at: '2026-11-29T04:31:00Z', visited_by: '花子' }),
  ],
};

function renderSpot() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/spot/a1']}>
      <Routes>
        <Route path="/planner/:planId/spot/:areaId" element={<SpotModePage />} />
        <Route path="/planner/:planId/today" element={<p>予定の画面</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // 当日(2026-11-29 13:48 JST)として動かす
  vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-29T04:48:00Z'));
  m.listSpotAreas.mockResolvedValue({ areas: [AREA], can_edit: true, genres: {} });
  m.saveSnapshot.mockResolvedValue(true);
  m.loadSnapshot.mockResolvedValue(null);
});

describe('スポットモード', () => {
  it('予定への切り替え・残り時間・候補の一覧・端末への保存', async () => {
    renderSpot();
    expect(await screen.findByRole('heading', { name: 'おかげ横丁・おはらい町', level: 1 })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: '表示の切り替え' });
    expect(within(nav).getByRole('link', { name: /予定/ })).toHaveAttribute('href', '/planner/p1/today');
    expect(within(nav).getByText('スポット')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/戻り始め/)).toBeInTheDocument();
    expect(screen.getByText(/残り 1:42/)).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'エリアの候補' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);
    expect(within(list).getByRole('button', { name: /おかげ座\(訪問済み\)/ })).toBeInTheDocument();
    await waitFor(() => expect(m.saveSnapshot).toHaveBeenCalledWith(null, 'spot-area:p1:a1', AREA));
  });

  it('ジャンルで絞り、印から候補を開いて、着いた・行きたい印を付ける', async () => {
    m.markSpotVisit.mockResolvedValue(AREA);
    m.setSpotWant.mockResolvedValue(AREA);
    renderSpot();
    const chips = await screen.findByRole('group', { name: 'ジャンルで絞る' });
    fireEvent.click(within(chips).getByRole('button', { name: /カフェ/ }));
    expect(within(chips).getByRole('button', { name: /カフェ/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list', { name: 'エリアの候補' })).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '印 赤福 本店' }));
    const detail = await screen.findByRole('region', { name: '赤福 本店' });
    expect(detail).toHaveTextContent('メモ: 縁台で食べられる');
    expect(within(detail).getByRole('link', { name: /Google マップで開く/ })).toHaveAttribute('href', expect.stringContaining('travelmode=walking'));
    fireEvent.click(within(detail).getByRole('button', { name: /着いた/ }));
    await waitFor(() => expect(m.markSpotVisit).toHaveBeenCalledWith('p1', 'a1', 'i1'));
    fireEvent.click(within(detail).getByRole('button', { name: '行きたい印を付ける' }));
    await waitFor(() => expect(m.setSpotWant).toHaveBeenCalledWith('p1', 'a1', 'i1', true));
  });

  it('次どこ？ は気分の札で並べ替え、理由を出す', async () => {
    renderSpot();
    fireEvent.click(await screen.findByRole('button', { name: /次どこ？/ }));
    const next = await screen.findByRole('region', { name: '次どこ行く？' });
    fireEvent.click(within(next).getByRole('button', { name: '雨・屋内' }));
    const first = within(next).getAllByRole('listitem')[0]!;
    expect(first).toHaveTextContent('五十鈴川のカフェ');
    expect(next).toHaveTextContent('AI は使っていません');
    expect(within(next).queryByText('おかげ座')).toBeNull();  // 済みは出さない
  });

  it('方角で見る・周りを探すは現在地が要る', async () => {
    renderSpot();
    fireEvent.click(await screen.findByRole('button', { name: '方角と距離で見る' }));
    expect(screen.getByRole('list', { name: '方角と距離' })).toBeInTheDocument();
    expect(screen.queryByTestId('map')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '周りを探す' }));
    expect(await screen.findByRole('button', { name: '現在地を使う' })).toBeInTheDocument();
    expect(m.searchNearby).not.toHaveBeenCalled();
  });

  it('[Gate2 G2-04] 周りを探すは、座標を検索サービスへ送ることを探す前に示す(メンバーには送らない)', async () => {
    const watchPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) => {
      ok({ coords: { latitude: 34.4614, longitude: 136.7244, accuracy: 10 } });
      return 1;
    });
    Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch: vi.fn() }, configurable: true });
    renderSpot();
    fireEvent.click(await screen.findByRole('button', { name: '周りを探す' }));
    fireEvent.click(await screen.findByRole('button', { name: '現在地を使う' }));
    expect(await screen.findByTestId('spot-nearby-privacy')).toHaveTextContent('場所の検索サービスへ送ります');
    expect(screen.getByTestId('spot-nearby-privacy')).toHaveTextContent('メンバーには送りません');
  });

  it('[Gate2 G2-10] 周りを探す: 検索サービスの失敗は「何もない」と区別して出す', async () => {
    m.searchNearby.mockResolvedValue({ results: [], sources: [], failed_providers: ['yahoo_local'], message: null });
    const watchPosition = vi.fn((ok: (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) => {
      ok({ coords: { latitude: 34.4614, longitude: 136.7244, accuracy: 10 } }); return 1; });
    Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch: vi.fn() }, configurable: true });
    renderSpot();
    fireEvent.click(await screen.findByRole('button', { name: '周りを探す' }));
    fireEvent.click(await screen.findByRole('button', { name: '現在地を使う' }));
    fireEvent.click(await screen.findByRole('button', { name: '探す' }));
    expect(await screen.findByText(/周りに何もないという意味ではありません/)).toBeInTheDocument();
  });

  it('その日でなければ残り時間を出さず、時間枠を示す', async () => {
    vi.setSystemTime(new Date('2026-11-20T04:48:00Z'));
    renderSpot();
    expect(await screen.findByText(/当日 2026-11-29 13:00〜15:30/)).toBeInTheDocument();
    expect(screen.queryByText(/戻り始め/)).toBeNull();
  });

  it('別行動: みんなの集合の約束を見て、自分の別行動を知らせる(位置は送らない)', async () => {
    m.splitOff.mockResolvedValue(AREA);
    renderSpot();
    const split = await screen.findByRole('region', { name: /別行動と集合/ });
    expect(within(split).getByRole('list', { name: '別行動の約束' })).toHaveTextContent('太郎: 15:20 に 駐車場 で合流');
    fireEvent.click(within(split).getByRole('button', { name: '別行動にする' }));
    expect(within(split).getByLabelText('集合の時刻')).toHaveValue('15:30');
    fireEvent.change(within(split).getByLabelText('ひとこと(任意)'), { target: { value: '赤福で並びます' } });
    fireEvent.click(within(split).getByRole('button', { name: 'みんなに知らせる' }));
    await waitFor(() => expect(m.splitOff).toHaveBeenCalledWith('p1', 'a1',
      { meet_time: '15:30', meet_label: '駐車場', note: '赤福で並びます' }));
  });

  it('通信できない時は端末に保存したエリアを出す', async () => {
    m.listSpotAreas.mockRejectedValue(new Error('offline'));
    m.loadSnapshot.mockResolvedValue({ data: AREA, savedAt: Date.UTC(2026, 10, 29, 3, 0) });
    renderSpot();
    expect(await screen.findByText(/端末に保存した情報/)).toBeInTheDocument();
    expect(screen.getByRole('list', { name: '方角と距離' })).toBeInTheDocument();
  });
});

describe('自由に歩くエリアの準備', () => {
  const cands = [
    { id: 'c1', title: '赤福 本店', status: 'open', merged_into_id: null, latitude: 34.4610, longitude: 136.7247 },
    { id: 'c2', title: '五十鈴川のカフェ', status: 'open', merged_into_id: null, latitude: 34.4605, longitude: 136.7262 },
    { id: 'c3', title: 'おかげ座', status: 'open', merged_into_id: null, latitude: 34.4617, longitude: 136.7240 },
  ];
  const renderSetup = () => render(
    <MemoryRouter initialEntries={['/planner/p1/spot-areas']}>
      <Routes><Route path="/planner/:planId/spot-areas" element={<SpotAreasPage />} /></Routes>
    </MemoryRouter>,
  );

  beforeEach(() => {
    m.listSpotAreas.mockResolvedValue({ areas: [], can_edit: true, genres: {} });
    m.getCandidates.mockResolvedValue({ items: cands });
    m.getPlanDetail.mockResolvedValue({ data: { days: [{ id: 'd1', local_date: '2026-11-29', timezone_id: 'Asia/Tokyo', sort_order: 1 }] } });
    m.suggestSpotAreas.mockResolvedValue([{ title: '赤福 本店の周り', center_latitude: 34.46, center_longitude: 136.72, radius_m: 250,
      candidates: cands.map((c, k) => ({ candidate_id: c.id, title: c.title, genre: (['food', 'cafe', 'sight'] as const)[k] })) }]);
    m.createSpotArea.mockResolvedValue({ ...AREA, title: 'おかげ横丁' });
  });

  it('近くにまとまった候補をまとめてエリアにし、優先と滞在を決めて保存する', async () => {
    renderSetup();
    fireEvent.click(await screen.findByRole('button', { name: 'まとめてエリアにする' }));
    const form = screen.getByRole('form', { name: 'エリアの設定' });
    fireEvent.change(within(form).getByLabelText('エリアの名前'), { target: { value: 'おかげ横丁' } });
    fireEvent.change(within(form).getByLabelText('始まり'), { target: { value: '13:00' } });
    fireEvent.change(within(form).getByLabelText('終わり'), { target: { value: '15:30' } });
    fireEvent.change(within(form).getByLabelText('集合の場所(戻る場所)'), { target: { value: '駐車場' } });
    fireEvent.click(within(within(form).getByRole('group', { name: '赤福 本店の優先' })).getByRole('button', { name: '行きたい' }));
    fireEvent.change(within(form).getByLabelText('五十鈴川のカフェの滞在の目安'), { target: { value: '30' } });
    fireEvent.click(within(form).getByRole('button', { name: 'おかげ座を上へ' }));
    expect(within(form).getByText(/「行きたい」だけなら 約 20分/)).toBeInTheDocument();
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.createSpotArea).toHaveBeenCalledWith('p1', expect.objectContaining({
      title: 'おかげ横丁', day_id: 'd1', start_time: '13:00', end_time: '15:30', meet_label: '駐車場', suggest_on_approach: true,
      items: [
        { candidate_id: 'c1', genre: 'food', priority: 'want', stay_minutes: 20 },
        { candidate_id: 'c3', genre: 'sight', priority: 'maybe', stay_minutes: 20 },
        { candidate_id: 'c2', genre: 'cafe', priority: 'maybe', stay_minutes: 30 },
      ],
    })));
  });

  it('終わりが始まりより前なら保存しない・既存のエリアは If-Match で直す', async () => {
    m.listSpotAreas.mockResolvedValue({ areas: [AREA], can_edit: true, genres: {} });
    m.updateSpotArea.mockResolvedValue(AREA);
    renderSetup();
    expect(await screen.findByRole('link', { name: /スポットモードで開く/ })).toHaveAttribute('href', '/planner/p1/spot/a1');
    fireEvent.click(screen.getByRole('button', { name: '直す' }));
    const form = screen.getByRole('form', { name: 'エリアの設定' });
    fireEvent.change(within(form).getByLabelText('終わり'), { target: { value: '12:00' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('終わりは始まりより後');
    fireEvent.change(within(form).getByLabelText('終わり'), { target: { value: '16:00' } });
    fireEvent.click(within(form).getByRole('button', { name: '保存' }));
    await waitFor(() => expect(m.updateSpotArea).toHaveBeenCalledWith('p1', 'a1', expect.objectContaining({ end_time: '16:00' }), 3));
  });

  it('閲覧者には作る・直す操作を出さない', async () => {
    m.listSpotAreas.mockResolvedValue({ areas: [{ ...AREA, can_edit: false }], can_edit: false, genres: {} });
    renderSetup();
    expect(await screen.findByRole('link', { name: /スポットモードで開く/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '直す' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'エリアを作る' })).toBeNull();
    expect(m.suggestSpotAreas).not.toHaveBeenCalled();
  });
});
