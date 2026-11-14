/**
 * [Gate V2] VisitsPage(訪問の地図、FR-049〜051)の画面テスト。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { LocationTrackList, VisitsOverview } from '@/services/api';
import { appendLocalPoint } from '@/utils/trackRecorder';

const m = vi.hoisted(() => ({
  getVisits: vi.fn(), assessVisits: vi.fn(), correctVisit: vi.fn(), postDeviceVisitResults: vi.fn(),
  getLocationTracks: vi.fn(),
}));
vi.mock('@/services/api', () => ({ ...m }));
// [Gate Remaining-7] 実の地図(Leaflet)は jsdom で描けないため、地図の部品は置き換える
vi.mock('./visits/VisitTileMap', () => ({
  default: ({ items, candidates }: { items: unknown[]; candidates: unknown[] }) => (
    <div data-testid="visit-tile-map">{`tiles ${items.length} candidates ${candidates.length}`}</div>),
}));

import VisitsPage from './VisitsPage';

const empty = fx.visits_empty as unknown as VisitsOverview;
const assessed = fx.visits_assessed as unknown as VisitsOverview;
const reassessed = fx.visits_reassessed as unknown as VisitsOverview;
const E1 = '00000000-0000-4000-8000-0000000000e1';
const E3 = '00000000-0000-4000-8000-0000000000e3';

const renderPage = () => render(
  <MemoryRouter initialEntries={['/planner/p1/visits']}>
    <Routes><Route path="/planner/:planId/visits" element={<VisitsPage />} /></Routes>
  </MemoryRouter>,
);

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(m)) fn.mockReset();
});

const article = (name: string) => screen.getByRole('article', { name });

describe('VisitsPage (Gate V2)', () => {
  it('判定する前: 位置のある予定を「予定」として一覧と略図に出し、判定するとサーバーで判定する', async () => {
    m.getVisits.mockResolvedValue(empty);
    m.assessVisits.mockResolvedValue(assessed);
    renderPage();
    expect(await screen.findByRole('heading', { name: '訪問の地図', level: 1 })).toBeInTheDocument();
    // [Gate Remaining-7] 既定は実の地図(OpenStreetMap)。略図へ切り替えられる
    expect(await screen.findByTestId('visit-tile-map')).toHaveTextContent('tiles 3 candidates 0');
    fireEvent.click(screen.getByRole('button', { name: '略図' }));
    expect(await screen.findByRole('img', { name: /訪問の地図\(略図\)。表示中 3件/ })).toBeInTheDocument();
    expect(within(article('清水寺')).getByText('まだ判定していません(半径200m)')).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole('region', { name: '訪問の判定' })).getByRole('button', { name: '判定する' }));
    await waitFor(() => expect(m.assessVisits).toHaveBeenCalledWith('p1'));
    expect(await screen.findByRole('status')).toHaveTextContent('判定しました(新しい判定 2件・変わった判定 0件)。確認が必要な判定が 2件あります');
    // 端末だけの軌跡が無いので、端末の数値は送らない
    expect(m.postDeviceVisitResults).not.toHaveBeenCalled();
    const k = article('清水寺');
    expect(within(k).getByTestId('layer-state')).toHaveTextContent('滞在');
    expect(within(k).getByText('確認してください')).toBeInTheDocument();
    expect(within(k).getByText('70%(要確認)')).toBeInTheDocument();
    expect(within(k).getByText('サーバーに保存した軌跡から判定')).toBeInTheDocument();
    expect(within(article('京都駅')).getByTestId('layer-state')).toHaveTextContent('通過');
  });

  it('訂正は判定の revision を If-Match に送り、判定の無い予定には送らない', async () => {
    m.getVisits.mockResolvedValue(assessed);
    m.correctVisit.mockResolvedValue(fx.visit_corrected_confirm);
    renderPage();
    const k = await screen.findByRole('article', { name: '清水寺' });
    fireEvent.click(within(k).getByRole('button', { name: '清水寺: 行った(確定)' }));
    await waitFor(() => expect(m.correctVisit).toHaveBeenCalledWith('p1', E1, 'confirm', 1));
    expect(await screen.findByRole('status')).toHaveTextContent('清水寺: 「行った」と確定しました');
    fireEvent.click(within(article('大阪城')).getByRole('button', { name: '大阪城: 行っていない' }));
    await waitFor(() => expect(m.correctVisit).toHaveBeenLastCalledWith('p1', E3, 'reject', undefined));
  });

  it('自動の判定と違う時に示し、状態の表示を切り替えられる(非表示は略図に描かない)', async () => {
    const hidden = {
      ...reassessed,
      items: reassessed.items.map((i) => (i.event_id === E1 ? { ...i, layer_state: 'HIDDEN' as const,
        assessment: { ...i.assessment!, hidden: true } } : i)),
      counts: { ...reassessed.counts, VERIFIED: 0, HIDDEN: 1 },
    };
    m.getVisits.mockResolvedValue(reassessed);
    const { unmount } = renderPage();
    const k = await screen.findByRole('article', { name: '清水寺' });
    expect(within(k).getByText('自動の判定は「訪問の可能性」です(あなたの判定を優先しています)')).toBeInTheDocument();
    expect(within(k).getByRole('button', { name: '清水寺: 自動の判定に戻す' })).toBeInTheDocument();
    unmount();

    m.getVisits.mockResolvedValue(hidden);
    renderPage();
    const hiddenBox = await screen.findByRole('checkbox', { name: /非表示\(1件\)/ });
    // 非表示は既定で一覧にも出さない。切り替えると一覧に出るが、略図には描かない
    expect(screen.queryByRole('article', { name: '清水寺' })).toBeNull();
    fireEvent.click(hiddenBox);
    const h = await screen.findByRole('article', { name: '清水寺' });
    expect(within(h).getByText(/地図と Atlas から隠しています/)).toBeInTheDocument();
    expect(within(h).getByRole('button', { name: '清水寺: 隠すのをやめる' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '略図' }));
    const map = screen.getByRole('img', { name: /訪問の地図\(略図\)/ });
    expect(map.querySelector('[data-layer-state="HIDDEN"]')).toBeNull();
    expect(map.querySelectorAll('g[data-layer-state]')).toHaveLength(2);
    // 通過を隠す
    fireEvent.click(screen.getByRole('checkbox', { name: /通過/ }));
    expect(screen.queryByRole('article', { name: '京都駅' })).toBeNull();
  });

  it('この端末だけの軌跡は、予定の場所ごとの数値だけを送る(座標は送らない)', async () => {
    const withDevice = { ...empty, tracks: { synced: 0, device: 1 } };
    const tracks = fx.location_tracks_active as LocationTrackList;
    const local = { ...tracks, tracks: [{ ...tracks.tracks[0]!, id: 'local-1', mode: 'device_only' as const }] };
    m.getVisits.mockResolvedValue(withDevice);
    m.getLocationTracks.mockResolvedValue(local);
    m.postDeviceVisitResults.mockResolvedValue(fx.visits_device);
    m.assessVisits.mockResolvedValue(fx.visits_device);
    const t0 = Date.UTC(2026, 10, 1, 1, 0, 0);
    for (let i = 0; i <= 12; i += 2) {
      appendLocalPoint('local-1', { recorded_at: new Date(t0 + i * 60_000).toISOString(), latitude: 34.9950,
        longitude: 135.785, accuracy_m: 9 });
    }
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: '判定する' }));
    await waitFor(() => expect(m.postDeviceVisitResults).toHaveBeenCalled());
    const [planId, results] = m.postDeviceVisitResults.mock.calls[0]!;
    expect(planId).toBe('p1');
    expect(results).toEqual([{ event_id: E1, metrics: expect.objectContaining({ points_inside: 7, dwell_seconds: 720 }) }]);
    expect(JSON.stringify(results)).not.toContain('34.995');
    expect(await screen.findByRole('status')).toHaveTextContent('この端末の軌跡から 1件');
  });

  it('取得に失敗したら案内する', async () => {
    m.getVisits.mockRejectedValue(new Error('network'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('訪問の地図を取得できませんでした');
  });

  it('[Remaining-7] 候補の層(候補箱)を地図に重ね、切り替えられる', async () => {
    m.getVisits.mockResolvedValue({ ...empty, candidates: [{ candidate_id: 'c1', title: '伏見稲荷', category: null, priority: 1,
      latitude: 34.96, longitude: 135.77, layer_state: 'CANDIDATE' }] });
    renderPage();
    expect(await screen.findByTestId('visit-tile-map')).toHaveTextContent('candidates 1');
    fireEvent.click(screen.getByTestId('visit-candidates-toggle'));
    expect(screen.getByTestId('visit-tile-map')).toHaveTextContent('candidates 0');
  });
});
