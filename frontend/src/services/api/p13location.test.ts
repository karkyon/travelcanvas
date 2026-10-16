/**
 * [Gate P13] 任意の位置軌跡(FR-038)APIのクライアント。送信内容(URL・If-Match・batch_id・削除の時間帯・
 * 共通エラー処理を通さない指定)と、実backendから採取した応答(__fixtures__)のdecoder検証を固定する。
 */
import { describe, it, expect } from 'vitest';
import type { AxiosRequestConfig } from 'axios';
import fx from './__fixtures__/backendContractResponses.json';
import {
  api, changeLocationTrack, deleteLocationTrack, deleteTrackPoints, getLocationTrack, getLocationTracks,
  startLocationTrack, uploadTrackPoints,
} from './index';
import { decodeResponse } from './decode';
import { locationTrack, locationTrackList } from './decoders';
import type { MinimalHttpClient } from './types';

type Call = { url: string; method: string; data?: unknown; config?: AxiosRequestConfig };

function respondWith(data: unknown): Call[] {
  const calls: Call[] = [];
  const push = (method: string) => async (url: string, a?: unknown, b?: AxiosRequestConfig) => {
    if (method === 'GET' || method === 'DELETE') calls.push({ url, method, config: a as AxiosRequestConfig });
    else calls.push({ url, method, data: a, config: b });
    return { data };
  };
  api.setHttpClientForTesting({
    get: push('GET'), post: push('POST'), patch: push('PATCH'), delete: push('DELETE'),
  } as Partial<MinimalHttpClient>);
  return calls;
}

describe('位置の軌跡APIクライアント (Gate P13)', () => {
  it('一覧・開始・詳細・一時停止(If-Match)', async () => {
    let calls = respondWith(fx.location_tracks_no_consent);
    const list = await getLocationTracks('p1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks', config: { skipGlobalErrorHandler: true } });
    expect(list.location_consent).toBe(false);
    expect(list.can_start).toBe(false);
    calls = respondWith(fx.location_track_started);
    await startLocationTrack('p1', 'synced', 'standard');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks', method: 'POST', data: { mode: 'synced', precision: 'standard' } });
    calls = respondWith(fx.location_track_detail);
    const d = await getLocationTrack('p1', 't1');
    expect(calls[0]!.url).toBe('/plans/p1/location-tracks/t1');
    expect(d.points).toHaveLength(3);
    expect(d.distance_m).toBeGreaterThan(0);
    calls = respondWith(fx.location_track_paused);
    await changeLocationTrack('p1', 't1', 'pause', 1);
    expect(calls[0]).toMatchObject({ method: 'PATCH', data: { action: 'pause' }, config: { headers: { 'If-Match': '1' } } });
  });

  it('点の送信(batch_id)・時間帯の削除・軌跡の削除', async () => {
    let calls = respondWith(fx.location_points_uploaded);
    const pts = [{ recorded_at: '2026-11-01T01:01:00Z', latitude: 35, longitude: 135, accuracy_m: 5 }];
    const res = await uploadTrackPoints('p1', 't1', 'b1', pts);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks/t1/points', data: { batch_id: 'b1', points: pts } });
    expect(res.rejected.outside_period).toBe(1);
    calls = respondWith(fx.location_points_deleted);
    expect((await deleteTrackPoints('p1', 't1', 'S', 'E')).removed).toBe(1);
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks/t1/points', method: 'DELETE', config: { params: { start: 'S', end: 'E' } } });
    calls = respondWith(undefined);
    await deleteLocationTrack('p1', 't1');
    expect(calls[0]).toMatchObject({ url: '/plans/p1/location-tracks/t1', method: 'DELETE' });
  });

  it('列挙値を厳密に検査する', () => {
    expect(() => decodeResponse({ ...fx.location_track_started, mode: 'cloud' }, locationTrack, 'x')).toThrow(/\$\.mode/);
    expect(() => decodeResponse({ ...fx.location_track_stopped, stopped_reason: 'crash' }, locationTrack, 'x')).toThrow(/stopped_reason/);
    expect(decodeResponse(fx.location_tracks_active, locationTrackList, 'x').active_track_id).toBe(fx.location_track_started.id);
  });
});
