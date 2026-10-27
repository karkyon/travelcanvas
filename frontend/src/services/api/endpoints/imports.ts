/**
 * 予約取込(FR-011)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { RouteOptionsApi } from './routeOptions';
import type { ExtractionCandidate, ExtractionCandidateCreateData, ImportJob, ImportJobCreateData, ImportJobDetail } from '../types';
import { arrayOf, decodeResponse } from '../decode';
// [Gate G9] Q03 decoder は使う時に読み込む(最初に読む JS を小さく保つ)
const DL = () => import('../decoders');

export class ImportsApi extends RouteOptionsApi {
  // [Gate R3-9] FR-011予約取込(import_jobs/extraction_candidates)
  async getImportJobs(planId: string): Promise<ImportJob[]> {
    const response = await this.client.get(`/plans/${planId}/imports`);
    return decodeResponse(response.data, arrayOf((await DL()).importJob), 'GET /plans/{plan_id}/imports');
  }

  async getImportJob(planId: string, jobId: string): Promise<ImportJobDetail> {
    const response = await this.client.get(`/plans/${planId}/imports/${jobId}`);
    return decodeResponse(response.data, (await DL()).importJobDetail, 'GET /plans/{plan_id}/imports/{job_id}');
  }

  async createImportJob(planId: string, data: ImportJobCreateData): Promise<ImportJob> {
    const response = await this.client.post(`/plans/${planId}/imports`, data);
    return decodeResponse(response.data, (await DL()).importJob, 'POST /plans/{plan_id}/imports');
  }

  async createExtractionCandidate(
    planId: string, jobId: string, data: ExtractionCandidateCreateData
  ): Promise<ExtractionCandidate> {
    const response = await this.client.post(
      `/plans/${planId}/imports/${jobId}/candidates`, data
    );
    return decodeResponse(response.data, (await DL()).extractionCandidate, 'POST /plans/{plan_id}/imports/{job_id}/candidates');
  }

  async acceptExtractionCandidate(planId: string, jobId: string, candidateId: string): Promise<ExtractionCandidate> {
    const response = await this.client.post(
      `/plans/${planId}/imports/${jobId}/candidates/${candidateId}/accept`, {}
    );
    return decodeResponse(response.data, (await DL()).extractionCandidate, 'POST /plans/{plan_id}/imports/{job_id}/candidates/{candidate_id}/accept');
  }

  async rejectExtractionCandidate(planId: string, jobId: string, candidateId: string): Promise<ExtractionCandidate> {
    const response = await this.client.post(
      `/plans/${planId}/imports/${jobId}/candidates/${candidateId}/reject`, {}
    );
    return decodeResponse(response.data, (await DL()).extractionCandidate, 'POST /plans/{plan_id}/imports/{job_id}/candidates/{candidate_id}/reject');
  }

  async confirmImportJob(planId: string, jobId: string): Promise<ImportJob> {
    const response = await this.client.post(`/plans/${planId}/imports/${jobId}/confirm`, {});
    return decodeResponse(response.data, (await DL()).importJob, 'POST /plans/{plan_id}/imports/{job_id}/confirm');
  }

  async rejectImportJob(planId: string, jobId: string): Promise<ImportJob> {
    const response = await this.client.post(`/plans/${planId}/imports/${jobId}/reject`, {});
    return decodeResponse(response.data, (await DL()).importJob, 'POST /plans/{plan_id}/imports/{job_id}/reject');
  }
}
