/**
 * [Gate P13] LocationTrackPage(任意の位置軌跡、FR-038)の画面テスト。位置の取得は navigator.geolocation を差し替える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { LocationTrackList } from '@/services/api';
import { loadLocalPoints } from '@/utils/trackRecorder';

const m = vi.hoisted(() => ({
  getLocationTracks: vi.fn(), startLocationTrack: vi.fn(), getLocationTrack: vi.fn(), changeLocationTrack: vi.fn(),
  uploadTrackPoints: vi.fn(), deleteTrackPoints: vi.fn(), deleteLocationTrack: vi.fn(), updateConsents: vi.fn(),
  getLocationSettings: vi.fn(), putLocationSettings: vi.fn(), putTrackSampling: vi.fn(), uploadAreaCells: vi.fn(),
}));
vi.mock('@/services/api', () => ({ ...m }));

import LocationTrackPage from './LocationTrackPage';
import { useTrackingStore } from '@/store/trackingStore';

type Success = (pos: GeolocationPosition) => void;
const geo = {
  success: null as Success | null, watchPosition: vi.fn(), clearWatch: vi.fn(), getCurrentPosition: vi.fn(),
  once: null as Success | null,
};

const active = fx.location_tracks_active as LocationTrackList;
const track = active.tracks[0]!;
const deviceOnly: LocationTrackList = { ...active, tracks: [{ ...track, mode: 'device_only', point_count: 0 }] };

function position(sec: number, lat: number): GeolocationPosition {
  return { timestamp: Date.UTC(2026, 10, 1, 1, 0, sec), coords: { latitude: lat, longitude: 135.785, accuracy: 8 } } as GeolocationPosition;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/planner/p1/track']}>
      <Routes>
        <Route path="/planner/:planId/track" element={<LocationTrackPage />} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  localStorage.clear();
  for (const fn of Object.values(m)) fn.mockReset();
  geo.success = null;
  geo.watchPosition.mockReset().mockImplementation((s: Success) => { geo.success = s; return 7; });
  geo.clearWatch.mockReset();
  geo.once = null;
  geo.getCurrentPosition.mockReset().mockImplementation((s: Success) => { geo.once = s; });
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  window.confirm = vi.fn(() => true);
  m.getLocationSettings.mockResolvedValue(fx.location_settings_unset);
  m.putTrackSampling.mockResolvedValue(fx.location_track_sampling);
  sessionStorage.clear();
  useTrackingStore.setState({ active: null });
});

describe('LocationTrackPage (Gate P13)', () => {
  it('同意が無ければ同意のボタンを出し、開始できない', async () => {
    m.getLocationTracks.mockResolvedValue(fx.location_tracks_no_consent);
    m.updateConsents.mockResolvedValue({ purposes: [] });
    renderPage();
    const start = await screen.findByRole('region', { name: '記録を始める' });
    expect(within(start).getByRole('button', { name: '記録を始める' })).toBeDisabled();
    fireEvent.click(within(start).getByRole('button', { name: '位置情報の利用に同意する' }));
    await waitFor(() => expect(m.updateConsents).toHaveBeenCalledWith({ location: true }));
    expect(geo.watchPosition).not.toHaveBeenCalled();
  });

  it('[Gate L5] 旅行ごとの位置の扱いを選んでから始める(未選択・「記録しない」では始められない)', async () => {
    m.getLocationTracks.mockResolvedValue(fx.location_tracks_empty);
    m.putLocationSettings.mockResolvedValue({ mode: 'synced', revision: 1, updated_at: null, stopped_tracks: 0 });
    m.startLocationTrack.mockResolvedValue(fx.location_track_started);
    renderPage();
    const settings = await screen.findByRole('region', { name: 'この旅行での位置の扱い' });
    const start = screen.getByRole('region', { name: '記録を始める' });
    expect(within(settings).getByText('まだ選んでいません(位置は記録していません)')).toBeInTheDocument();
    expect(within(start).getByRole('button', { name: '記録を始める' })).toBeDisabled();
    fireEvent.click(within(settings).getByLabelText(/暗号化してサーバーへ/));
    m.getLocationTracks.mockResolvedValue({ ...fx.location_tracks_empty, trip_mode: 'synced' });
    fireEvent.click(within(settings).getByRole('button', { name: '位置の扱いを保存' }));
    await waitFor(() => expect(m.putLocationSettings).toHaveBeenCalledWith('p1', 'synced', 0));
    await waitFor(() => expect(within(start).getByRole('button', { name: '記録を始める' })).toBeEnabled());
    fireEvent.change(within(start).getByLabelText('精度'), { target: { value: 'high' } });
    fireEvent.click(within(start).getByRole('button', { name: '記録を始める' }));
    await waitFor(() => expect(m.startLocationTrack).toHaveBeenCalledWith('p1', null, 'high'));
  });

  it('[Gate L5] 訪問地域だけ同期: 座標は端末に置き、区画だけを送る。観測値も送る', async () => {
    m.getLocationTracks.mockResolvedValue(fx.location_tracks_areas_active);
    m.uploadAreaCells.mockResolvedValue(fx.area_cells_uploaded);
    m.changeLocationTrack.mockResolvedValue(fx.location_track_stopped);
    const areas = fx.location_tracks_areas_active.tracks[0]!;
    renderPage();
    const panel = await screen.findByRole('region', { name: '記録中の軌跡' });
    expect(within(panel).getByText(/訪問地域だけ同期/)).toBeInTheDocument();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    act(() => {
      geo.success!(position(0, 34.9948));
      geo.success!(position(70, 34.9958));
    });
    expect(loadLocalPoints(areas.id)).toHaveLength(2);
    fireEvent.click(within(panel).getByRole('button', { name: '今すぐ送る' }));
    await waitFor(() => expect(m.uploadAreaCells).toHaveBeenCalled());
    const cells = m.uploadAreaCells.mock.calls[0]![2] as Array<Record<string, unknown>>;
    expect(cells).toHaveLength(1);
    expect(cells[0]!.key).toBe('0.1:34.9:135.7');
    expect(JSON.stringify(cells)).not.toContain('34.9948');
    expect(m.uploadTrackPoints).not.toHaveBeenCalled();
    expect(await within(panel).findByText(/送った区画: 2件/)).toBeInTheDocument();
    // 記録中であることを、ほかの画面にも示す状態になっている
    expect(useTrackingStore.getState().active).toMatchObject({ planId: 'p1', trackId: areas.id, capturing: true });
    fireEvent.click(within(panel).getByRole('button', { name: '記録を止める' }));
    await waitFor(() => expect(m.putTrackSampling).toHaveBeenCalled());
    const sampling = m.putTrackSampling.mock.calls[0]![2];
    // サーバーにあった観測値(40件)に、この画面で残した2件を足して送る
    expect(sampling).toMatchObject({ kept_samples: 42 });
    expect(JSON.stringify(sampling)).not.toMatch(/latitude|longitude/);
  });

  it('[Gate L5] 電池が少ないと省電力の段階になり、間隔をあけて1回ずつ取る。手動で記録できる', async () => {
    Object.defineProperty(navigator, 'getBattery', {
      value: async () => ({ level: 0.12, charging: false }), configurable: true,
    });
    m.getLocationTracks.mockResolvedValue(deviceOnly);
    renderPage();
    const panel = await screen.findByRole('region', { name: '記録中の軌跡' });
    expect(await within(panel).findByText('取得の間隔: 電池が少ないため省電力')).toBeInTheDocument();
    expect(within(panel).getByText('電池: 12%')).toBeInTheDocument();
    await waitFor(() => expect(geo.getCurrentPosition).toHaveBeenCalled());
    fireEvent.click(within(panel).getByRole('button', { name: '今の場所を記録' }));
    act(() => geo.once!(position(0, 34.9948)));
    expect(loadLocalPoints(track.id)).toHaveLength(1);
    Object.defineProperty(navigator, 'getBattery', { value: undefined, configurable: true });
  });

  it('暗号化してサーバーへ: 取得した位置を溜め、「今すぐ送る」でbatch_id付きで送る', async () => {
    m.getLocationTracks.mockResolvedValue(active);
    m.uploadTrackPoints.mockResolvedValue(fx.location_points_uploaded);
    renderPage();
    const panel = await screen.findByRole('region', { name: '記録中の軌跡' });
    expect(within(panel).getByText('● 位置を記録しています')).toBeInTheDocument();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    act(() => {
      geo.success!(position(0, 34.9948));
      geo.success!(position(10, 34.9958)); // 約110m動いた
      geo.success!(position(20, 34.9958)); // 動かず10秒 → 残さない
    });
    expect(within(panel).getByText(/未送信: 2件/)).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '今すぐ送る' }));
    await waitFor(() => expect(m.uploadTrackPoints).toHaveBeenCalledTimes(1));
    const [planId, trackId, batchId, points] = m.uploadTrackPoints.mock.calls[0]!;
    expect([planId, trackId, typeof batchId, points.length]).toEqual(['p1', track.id, 'string', 2]);
    await waitFor(() => expect(within(panel).queryByRole('button', { name: '今すぐ送る' })).toBeNull());
  });

  it('この端末だけ: 位置は端末にだけ保存し、サーバーへ送らない。停止できる', async () => {
    m.getLocationTracks.mockResolvedValue(deviceOnly);
    m.changeLocationTrack.mockResolvedValue(fx.location_track_stopped);
    renderPage();
    const panel = await screen.findByRole('region', { name: '記録中の軌跡' });
    expect(within(panel).queryByRole('button', { name: '今すぐ送る' })).toBeNull();
    await waitFor(() => expect(geo.watchPosition).toHaveBeenCalled());
    act(() => geo.success!(position(0, 34.9948)));
    expect(loadLocalPoints(track.id)).toHaveLength(1);
    fireEvent.click(within(panel).getByRole('button', { name: '記録を止める' }));
    await waitFor(() => expect(m.changeLocationTrack).toHaveBeenCalledWith('p1', track.id, 'stop', track.revision));
    expect(m.uploadTrackPoints).not.toHaveBeenCalled();
  });

  it('軌跡を見て、時間帯を消し、軌跡を削除する(端末の座標も消す)', async () => {
    m.getLocationTracks.mockResolvedValue({ ...active, active_track_id: null, can_start: false,
      tracks: [fx.location_track_stopped] });
    m.getLocationTrack.mockResolvedValue(fx.location_track_detail);
    m.deleteTrackPoints.mockResolvedValue(fx.location_points_deleted);
    m.deleteLocationTrack.mockResolvedValue(undefined);
    renderPage();
    const list = await screen.findByRole('region', { name: '記録した軌跡' });
    expect(within(list).getByText(/自分で停止/)).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: '軌跡を見る' }));
    expect(await within(list).findByRole('img', { name: '軌跡の略図(点3件)' })).toBeInTheDocument();
    fireEvent.click(within(list).getByRole('button', { name: 'この時間帯を消す' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('消す時間帯の開始と終了');
    fireEvent.change(within(list).getByLabelText('開始'), { target: { value: '2026-11-01T10:01' } });
    fireEvent.change(within(list).getByLabelText('終了'), { target: { value: '2026-11-01T10:02' } });
    fireEvent.click(within(list).getByRole('button', { name: 'この時間帯を消す' }));
    await waitFor(() => expect(m.deleteTrackPoints).toHaveBeenCalledWith('p1', track.id, expect.any(String), expect.any(String)));
    expect(await screen.findByText('指定した時間帯の位置を消しました')).toBeInTheDocument();
    await waitFor(() => expect(within(list).getByRole('button', { name: '軌跡を削除' })).toBeEnabled());
    localStorage.setItem(`tc_track_points_${track.id}`, JSON.stringify([{ recorded_at: 'x', latitude: 1, longitude: 2, accuracy_m: null }]));
    fireEvent.click(within(list).getByRole('button', { name: '軌跡を削除' }));
    await waitFor(() => expect(m.deleteLocationTrack).toHaveBeenCalledWith('p1', track.id));
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(loadLocalPoints(track.id)).toEqual([])); // 端末の座標も消す
  });
});
