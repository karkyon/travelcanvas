/**
 * What-if・旅程ブランチ(FR-019)
 *
 * [Gate P7] backend/app/api/v1/branches.py。/plans/{planId}/branches配下。
 * 分岐案の編集・変更・採用・削除は分岐案のrevision(If-Match)。採用の409は構造化detail(code: branch_conflict / no_changes)。
 */
import { DataExportApi } from './dataExport';
import type { Branch, BranchContentInput, BranchCreateData, BranchDetail, BranchUpdateData } from '../types';
import { arrayOf, decodeResponse, int, object } from '../decode';
import { branch, branchDetail, revisionResult } from '../decoders';

const ifMatch = (revision: number) => ({ headers: { 'If-Match': String(revision) } });

export class BranchesApi extends DataExportApi {
  async getBranches(planId: string): Promise<Branch[]> {
    const response = await this.client.get(`/plans/${planId}/branches`);
    return decodeResponse(response.data, arrayOf(branch), 'GET /plans/{plan_id}/branches');
  }

  async createBranch(planId: string, data: BranchCreateData): Promise<BranchDetail> {
    const response = await this.client.post(`/plans/${planId}/branches`, data);
    return decodeResponse(response.data, branchDetail, 'POST /plans/{plan_id}/branches');
  }

  async getBranch(planId: string, branchId: string): Promise<BranchDetail> {
    const response = await this.client.get(`/plans/${planId}/branches/${branchId}`);
    return decodeResponse(response.data, branchDetail, 'GET /plans/{plan_id}/branches/{branch_id}');
  }

  async updateBranchContent(planId: string, branchId: string, events: BranchContentInput[], revision: number): Promise<BranchDetail> {
    const response = await this.client.put(`/plans/${planId}/branches/${branchId}/content`, { events }, ifMatch(revision));
    return decodeResponse(response.data, branchDetail, 'PUT /plans/{plan_id}/branches/{branch_id}/content');
  }

  async updateBranch(planId: string, branchId: string, data: BranchUpdateData, revision: number): Promise<BranchDetail> {
    const response = await this.client.patch(`/plans/${planId}/branches/${branchId}`, data, ifMatch(revision));
    return decodeResponse(response.data, branchDetail, 'PATCH /plans/{plan_id}/branches/{branch_id}');
  }

  async adoptBranch(planId: string, branchId: string, revision: number): Promise<{ branch: BranchDetail; plan_revision: number }> {
    const response = await this.client.post(`/plans/${planId}/branches/${branchId}/adopt`, undefined, ifMatch(revision));
    return decodeResponse(response.data, object({ branch: branchDetail, plan_revision: int }),
      'POST /plans/{plan_id}/branches/{branch_id}/adopt');
  }

  async deleteBranch(planId: string, branchId: string, revision: number): Promise<{ revision: number }> {
    const response = await this.client.delete(`/plans/${planId}/branches/${branchId}`, ifMatch(revision));
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/branches/{branch_id}');
  }
}
