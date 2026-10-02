/**
 * 持ち物(FR-025)・準備タスク・レディネス(FR-026)
 *
 * [Gate P1] backend/app/api/v1/preparation.py。/plans/{planId}配下。
 * 楽観ロックは持ち物・タスクごとのrevision(If-Match)。
 */
import { PlanTrashApi } from './planTrash';
import type {
  PackingItem, PackingItemCreateData, PackingItemUpdateData, PackingSuggestionConditions, PackingSuggestions,
  PlanMember, PreparationTask, PreparationTaskCreateData, PreparationTaskUpdateData, Readiness,
} from '../types';
import { arrayOf, decodeResponse } from '../decode';
import {
  packingItem, packingSuggestions, planMember, preparationTask, readiness, revisionResult,
} from '../decoders';

function conditionParams(c?: PackingSuggestionConditions): Record<string, boolean> | undefined {
  if (!c) return undefined;
  const params: Record<string, boolean> = {};
  for (const key of ['overseas', 'laundry', 'with_children', 'takes_medication'] as const) {
    if (c[key]) params[key] = true;
  }
  return Object.keys(params).length > 0 ? params : undefined;
}

export class PreparationApi extends PlanTrashApi {
  async getPlanMembers(planId: string): Promise<PlanMember[]> {
    const response = await this.client.get(`/plans/${planId}/members`);
    return decodeResponse(response.data, arrayOf(planMember), 'GET /plans/{plan_id}/members');
  }

  async getPackingItems(planId: string): Promise<PackingItem[]> {
    const response = await this.client.get(`/plans/${planId}/packing-items`);
    return decodeResponse(response.data, arrayOf(packingItem), 'GET /plans/{plan_id}/packing-items');
  }

  async createPackingItem(planId: string, data: PackingItemCreateData): Promise<PackingItem> {
    const response = await this.client.post(`/plans/${planId}/packing-items`, data);
    return decodeResponse(response.data, packingItem, 'POST /plans/{plan_id}/packing-items');
  }

  async updatePackingItem(
    planId: string, itemId: string, data: PackingItemUpdateData, ifMatch: number
  ): Promise<PackingItem> {
    const response = await this.client.patch(
      `/plans/${planId}/packing-items/${itemId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, packingItem, 'PATCH /plans/{plan_id}/packing-items/{item_id}');
  }

  async deletePackingItem(planId: string, itemId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/packing-items/${itemId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/packing-items/{item_id}');
  }

  async getPackingSuggestions(planId: string, conditions?: PackingSuggestionConditions): Promise<PackingSuggestions> {
    const response = await this.client.get(`/plans/${planId}/packing-suggestions`, {
      params: conditionParams(conditions),
    });
    return decodeResponse(response.data, packingSuggestions, 'GET /plans/{plan_id}/packing-suggestions');
  }

  async getPreparationTasks(planId: string): Promise<PreparationTask[]> {
    const response = await this.client.get(`/plans/${planId}/preparation-tasks`);
    return decodeResponse(response.data, arrayOf(preparationTask), 'GET /plans/{plan_id}/preparation-tasks');
  }

  async createPreparationTask(planId: string, data: PreparationTaskCreateData): Promise<PreparationTask> {
    const response = await this.client.post(`/plans/${planId}/preparation-tasks`, data);
    return decodeResponse(response.data, preparationTask, 'POST /plans/{plan_id}/preparation-tasks');
  }

  async updatePreparationTask(
    planId: string, taskId: string, data: PreparationTaskUpdateData, ifMatch: number
  ): Promise<PreparationTask> {
    const response = await this.client.patch(
      `/plans/${planId}/preparation-tasks/${taskId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, preparationTask, 'PATCH /plans/{plan_id}/preparation-tasks/{task_id}');
  }

  async deletePreparationTask(planId: string, taskId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/preparation-tasks/${taskId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/preparation-tasks/{task_id}');
  }

  async getReadiness(planId: string): Promise<Readiness> {
    const response = await this.client.get(`/plans/${planId}/readiness`);
    return decodeResponse(response.data, readiness, 'GET /plans/{plan_id}/readiness');
  }
}
