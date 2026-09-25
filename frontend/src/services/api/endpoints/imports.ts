/**
 * 予約取込(FR-011)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { RouteOptionsApi } from './routeOptions';
import type { ExtractionCandidate, ExtractionCandidateCreateData, ImportJob, ImportJobCreateData, ImportJobDetail } from '../types';

export class ImportsApi extends RouteOptionsApi {
  // [Gate R3-9] FR-011予約取込(import_jobs/extraction_candidates)
  async getImportJobs(planId: string): Promise<ImportJob[]> {
    const response = await this.client.get<ImportJob[]>(`/plans/${planId}/imports`);
    return response.data;
  }

  async getImportJob(planId: string, jobId: string): Promise<ImportJobDetail> {
    const response = await this.client.get<ImportJobDetail>(`/plans/${planId}/imports/${jobId}`);
    return response.data;
  }

  async createImportJob(planId: string, data: ImportJobCreateData): Promise<ImportJob> {
    const response = await this.client.post<ImportJob>(`/plans/${planId}/imports`, data);
    return response.data;
  }

  async createExtractionCandidate(
    planId: string, jobId: string, data: ExtractionCandidateCreateData
  ): Promise<ExtractionCandidate> {
    const response = await this.client.post<ExtractionCandidate>(
      `/plans/${planId}/imports/${jobId}/candidates`, data
    );
    return response.data;
  }

  async acceptExtractionCandidate(planId: string, jobId: string, candidateId: string): Promise<ExtractionCandidate> {
    const response = await this.client.post<ExtractionCandidate>(
      `/plans/${planId}/imports/${jobId}/candidates/${candidateId}/accept`, {}
    );
    return response.data;
  }

  async rejectExtractionCandidate(planId: string, jobId: string, candidateId: string): Promise<ExtractionCandidate> {
    const response = await this.client.post<ExtractionCandidate>(
      `/plans/${planId}/imports/${jobId}/candidates/${candidateId}/reject`, {}
    );
    return response.data;
  }

  async confirmImportJob(planId: string, jobId: string): Promise<ImportJob> {
    const response = await this.client.post<ImportJob>(`/plans/${planId}/imports/${jobId}/confirm`, {});
    return response.data;
  }

  async rejectImportJob(planId: string, jobId: string): Promise<ImportJob> {
    const response = await this.client.post<ImportJob>(`/plans/${planId}/imports/${jobId}/reject`, {});
    return response.data;
  }
}
