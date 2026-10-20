/**
 * 候補箱(FR-007)・場所の一元管理(FR-008)
 *
 * [Gate C2] backend/app/api/v1/candidates.py(/plans/{planId}/candidates)・places.py(/places・/plans/{planId}/places)。
 * 画面内でエラーを案内するため、共通エラー処理のtoastは出さない(SILENT)。更新は revision を If-Match に送る。
 */
import type { AxiosRequestConfig } from 'axios';
import { VisitsApi } from './visits';
import type { CandidateInput, CandidateList, CandidatePatch, OpeningHoursItem, PlaceInfo, PlacePatch, PlanPlaces } from '../types';
import { decodeResponse } from '../decode';
import { candidateList, placeInfo, planPlaces } from '../decoders';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const withRev = (revision: number): AxiosRequestConfig => ({ ...SILENT, headers: { 'If-Match': String(revision) } });

export class CandidatesApi extends VisitsApi {
  async getCandidates(planId: string): Promise<CandidateList> {
    const response = await this.client.get(`/plans/${planId}/candidates`, SILENT);
    return decodeResponse(response.data, candidateList, 'GET /plans/{plan_id}/candidates');
  }

  async createCandidate(planId: string, input: CandidateInput): Promise<CandidateList> {
    const response = await this.client.post(`/plans/${planId}/candidates`, input, SILENT);
    return decodeResponse(response.data, candidateList, 'POST /plans/{plan_id}/candidates');
  }

  async createCandidateFromSearch(planId: string, searchCandidateId: string, priority = 2): Promise<CandidateList> {
    const response = await this.client.post(`/plans/${planId}/candidates/from-search`,
      { search_candidate_id: searchCandidateId, priority }, SILENT);
    return decodeResponse(response.data, candidateList, 'POST /plans/{plan_id}/candidates/from-search');
  }

  async updateCandidate(planId: string, candidateId: string, patch: CandidatePatch, revision: number): Promise<CandidateList> {
    const response = await this.client.patch(`/plans/${planId}/candidates/${candidateId}`, patch, withRev(revision));
    return decodeResponse(response.data, candidateList, 'PATCH /plans/{plan_id}/candidates/{candidate_id}');
  }

  async deleteCandidate(planId: string, candidateId: string): Promise<void> {
    await this.client.delete(`/plans/${planId}/candidates/${candidateId}`, SILENT);
  }

  async scheduleCandidate(
    planId: string, candidateId: string, input: { day_id: string; local_start_time?: string | null; event_type?: string },
    revision: number,
  ): Promise<CandidateList> {
    const response = await this.client.post(`/plans/${planId}/candidates/${candidateId}/schedule`, input, withRev(revision));
    return decodeResponse(response.data, candidateList, 'POST /plans/{plan_id}/candidates/{candidate_id}/schedule');
  }

  async mergeCandidate(planId: string, candidateId: string, intoId: string, revision: number): Promise<CandidateList> {
    const response = await this.client.post(`/plans/${planId}/candidates/${candidateId}/merge`, { into_id: intoId },
      withRev(revision));
    return decodeResponse(response.data, candidateList, 'POST /plans/{plan_id}/candidates/{candidate_id}/merge');
  }

  async getPlaceInfo(placeId: string): Promise<PlaceInfo> {
    const response = await this.client.get(`/places/${placeId}`, SILENT);
    return decodeResponse(response.data, placeInfo, 'GET /places/{place_id}');
  }

  async updatePlace(placeId: string, patch: PlacePatch, revision: number): Promise<PlaceInfo> {
    const response = await this.client.patch(`/places/${placeId}`, patch, withRev(revision));
    return decodeResponse(response.data, placeInfo, 'PATCH /places/{place_id}');
  }

  async putOpeningHours(placeId: string, hours: OpeningHoursItem[], revision: number): Promise<PlaceInfo> {
    const response = await this.client.put(`/places/${placeId}/opening-hours`, { hours }, withRev(revision));
    return decodeResponse(response.data, placeInfo, 'PUT /places/{place_id}/opening-hours');
  }

  async getPlanPlaces(planId: string): Promise<PlanPlaces> {
    const response = await this.client.get(`/plans/${planId}/places`, SILENT);
    return decodeResponse(response.data, planPlaces, 'GET /plans/{plan_id}/places');
  }
}
