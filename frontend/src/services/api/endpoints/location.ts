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
  LocationTrack, LocationTrackDetail, LocationTrackList, TrackMode, TrackPoint, TrackPointsDeleteResult,
  TrackPointsUploadResult, TrackPrecision,
} from '../types';
import { decodeResponse } from '../decode';
import {
  locationTrack, locationTrackDetail, locationTrackList, trackPointsDeleteResult, trackPointsUploadResult,
} from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export class LocationApi extends MemoriesApi {
  async getLocationTracks(planId: string): Promise<LocationTrackList> {
    const response = await this.client.get(`/plans/${planId}/location-tracks`, SILENT);
    return decodeResponse(response.data, locationTrackList, 'GET /plans/{plan_id}/location-tracks');
  }

  async startLocationTrack(planId: string, mode: TrackMode, precision: TrackPrecision): Promise<LocationTrack> {
    const response = await this.client.post(`/plans/${planId}/location-tracks`, { mode, precision }, SILENT);
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
    const response = await this.client.delete(`/plans/${planId}/location-tracks/${trackId}/points`, {
      ...SILENT, params: { start, end },
    });
    return decodeResponse(response.data, trackPointsDeleteResult, 'DELETE /plans/{plan_id}/location-tracks/{track_id}/points');
  }

  async deleteLocationTrack(planId: string, trackId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/location-tracks/${trackId}`, SILENT);
  }
}
