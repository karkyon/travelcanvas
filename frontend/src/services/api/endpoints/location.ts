/**
 * 任意の位置軌跡(FR-038)
 *
 * [Gate P13] backend/app/api/v1/location_tracks.py。/plans/{planId}/location-tracks配下。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。
 * 点の送信は端末が付けた batch_id で再送しても二重に保存されない(通信に失敗したら同じ batch_id で送り直す)。
 */
import type { AxiosRequestConfig } from 'axios';
import { MemoriesApi } from './memories';
import type {
  AreaCellInput, AreaCellsUploadResult, LocationSettings, LocationTrack, LocationTrackDetail, LocationTrackList,
  TrackMode, TrackPoint, TrackPointsDeleteResult, TrackPointsUploadResult, TrackPrecision, TrackSamplingInput,
  TripLocationMode,
} from '../types';
import { decodeResponse } from '../decode';
import {
  areaCellsUploadResult, locationSettings, locationTrack, locationTrackDetail, locationTrackList,
  trackPointsDeleteResult, trackPointsUploadResult,
} from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class LocationApi extends MemoriesApi {
  async getLocationTracks(planId: string): Promise<LocationTrackList> {
    const response = await this.client.get(`/plans/${planId}/location-tracks`, SILENT);
    return decodeResponse(response.data, locationTrackList, 'GET /plans/{plan_id}/location-tracks');
  }

  /** [Gate L5] mode を省略すると、この旅行の位置の設定で始める */
  async startLocationTrack(planId: string, mode: TrackMode | null, precision: TrackPrecision): Promise<LocationTrack> {
    const body = mode ? { mode, precision } : { precision };
    const response = await this.client.post(`/plans/${planId}/location-tracks`, body, SILENT);
    return decodeResponse(response.data, locationTrack, 'POST /plans/{plan_id}/location-tracks');
  }

  async getLocationTrack(planId: string, trackId: string): Promise<LocationTrackDetail> {
    const response = await this.client.get(`/plans/${planId}/location-tracks/${trackId}`, SILENT);
    return decodeResponse(response.data, locationTrackDetail, 'GET /plans/{plan_id}/location-tracks/{track_id}');
  }

  async changeLocationTrack(
    planId: string, trackId: string, action: 'pause' | 'resume' | 'stop', revision: number,
  ): Promise<LocationTrack> {
    const response = await this.client.patch(`/plans/${planId}/location-tracks/${trackId}`, { action }, {
      ...SILENT, headers: { 'If-Match': String(revision) },
    });
    return decodeResponse(response.data, locationTrack, 'PATCH /plans/{plan_id}/location-tracks/{track_id}');
  }

  async uploadTrackPoints(
    planId: string, trackId: string, batchId: string, points: TrackPoint[],
  ): Promise<TrackPointsUploadResult> {
    const response = await this.client.post(
      `/plans/${planId}/location-tracks/${trackId}/points`, { batch_id: batchId, points }, SILENT,
    );
    return decodeResponse(response.data, trackPointsUploadResult, 'POST /plans/{plan_id}/location-tracks/{track_id}/points');
  }

  async deleteTrackPoints(planId: string, trackId: string, start: string, end: string): Promise<TrackPointsDeleteResult> {
    // [Gate S1] axios 1.20 で params の型が config の型引数から推論されるようになったため、型を明示する
    const config: AxiosRequestConfig = { ...SILENT, params: { start, end } };
    const response = await this.client.delete(`/plans/${planId}/location-tracks/${trackId}/points`, config);
    return decodeResponse(response.data, trackPointsDeleteResult, 'DELETE /plans/{plan_id}/location-tracks/{track_id}/points');
  }

  async deleteLocationTrack(planId: string, trackId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/location-tracks/${trackId}`, SILENT);
  }

  /** [Gate L5] この旅行の位置の扱い(本人の分。mode が null ならまだ選んでいない) */
  async getLocationSettings(planId: string): Promise<LocationSettings> {
    const response = await this.client.get(`/plans/${planId}/location-settings`, SILENT);
    return decodeResponse(response.data, locationSettings, 'GET /plans/{plan_id}/location-settings');
  }

  /** [Gate L5] 位置の扱いを変える(If-Match: 設定の revision。未設定は 0)。off にすると記録中の軌跡は止まる */
  async putLocationSettings(planId: string, mode: TripLocationMode, revision: number): Promise<LocationSettings> {
    const response = await this.client.put(`/plans/${planId}/location-settings`, { mode }, {
      ...SILENT, headers: { 'If-Match': String(revision) },
    });
    return decodeResponse(response.data, locationSettings, 'PUT /plans/{plan_id}/location-settings');
  }

  /** [Gate L5] 「訪問地域だけ同期」の区画を送る(同じ区画は合わせられるので送り直してよい) */
  async uploadAreaCells(planId: string, trackId: string, cells: AreaCellInput[]): Promise<AreaCellsUploadResult> {
    const response = await this.client.post(
      `/plans/${planId}/location-tracks/${trackId}/area-cells`, { cells }, SILENT,
    );
    return decodeResponse(response.data, areaCellsUploadResult, 'POST /plans/{plan_id}/location-tracks/{track_id}/area-cells');
  }

  /** [Gate L5] 端末の記録の観測値(電池・欠測率・取得の間隔の内訳。座標を含まない) */
  async putTrackSampling(planId: string, trackId: string, sampling: TrackSamplingInput): Promise<LocationTrack> {
    const response = await this.client.put(
      `/plans/${planId}/location-tracks/${trackId}/sampling`, { sampling }, SILENT,
    );
    return decodeResponse(response.data, locationTrack, 'PUT /plans/{plan_id}/location-tracks/{track_id}/sampling');
  }
}
