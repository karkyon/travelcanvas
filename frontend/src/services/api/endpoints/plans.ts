/**
 * 旅行プラン(/travel-plans/*)と正規化Plan/Day/Event(/plans/*)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { TravelPlan } from '@/types';
import { SpotsApi } from './spots';
import type { ApiResponse, NormalizedDay, NormalizedEvent, NormalizedPlanDetail, PromoteQuickDraftResult } from '../types';
import { apiOk, apiOkVoid } from '../response';
import { arrayOf, decodeResponse } from '../decode';
import { legacyTravelPlan, normalizedDay, normalizedEvent, normalizedPlanDetail, promoteQuickDraftResult, revisionResult } from '../decoders';

export class PlansApi extends SpotsApi {
  // [Gate #8] URLが実バックエンド(prefix="/travel-plans", main.pyでtravel.routerとして
  // /api/v1配下にマウント)と一致しておらず、'/plans'という存在しないパスに送信していた
  // ため、Gate #6で実装したtravel-plans CRUD APIはフロントエンドから一度も到達できて
  // いなかった実害バグ。
  // [Gate R0] 以前はここでitinerary.daysをTravelPlan.daysへ展開していたが、
  // Gate #29以降daysの正本は正規化API(/plans/*)のTravelDayであり、本APIの
  // itinerary JSON列は書込み対象外(Gate #34で422拒否)。ここでのdays展開は、
  // 正規化データ未取得時(loadPlan内でdetail取得に失敗した場合)のfallback
  // としてのみ残す。恒久対応はGate R1以降で検討する。
  protected planFromApi(raw: unknown): TravelPlan {
    if (!raw || typeof raw !== 'object') return raw as TravelPlan;
    const { itinerary, ...rest } = raw as { itinerary?: { days?: unknown[] } } & Record<string, unknown>;
    return {
      ...rest,
      days: (itinerary?.days ?? []) as TravelPlan['days'],
    } as TravelPlan;
  }

  // [Gate R0] 旧itinerary(JSON blob)書込み変換を削除。Gate #34でbackend
  // (/travel-plans)がitineraryフィールドを422で拒否するようになって以降、
  // このwrap処理は到達しても失敗するだけの契約違反コードとして残っていた
  // (2026-09-07 最新コード再監査報告書 追加技術欠陥#3)。day/eventの書込みは
  // 正規化API(/plans/*、createDay/updateDay/createEvent等)のみが正本であり、
  // metadata API(/travel-plans)へdaysを送ることはない(現行挙動を維持する)。
  protected planToApi(planData: Partial<TravelPlan> | null | undefined): Record<string, unknown> | null | undefined {
    if (!planData) return planData;
    const { days: _days, ...rest } = planData;
    void _days;
    return rest;
  }

  async getPlans(): Promise<ApiResponse<TravelPlan[]>> {
    const response = await this.client.get<{ plans?: unknown[]; data?: unknown[]; message?: string }>('/travel-plans/');
    const body = response.data;
    const plans = decodeResponse(body.plans ?? body.data ?? [], arrayOf(legacyTravelPlan), 'GET /travel-plans/')
      .map((p: unknown) => this.planFromApi(p));
    return apiOk(plans, body.message ?? '');
  }

  async createPlan(planData: Partial<TravelPlan>): Promise<ApiResponse<TravelPlan>> {
    const response = await this.client.post<unknown>('/travel-plans/', this.planToApi(planData));
    return apiOk<TravelPlan>(this.planFromApi(decodeResponse(response.data, legacyTravelPlan, 'POST /travel-plans/')));
  }

  async getPlan(planId: string): Promise<ApiResponse<TravelPlan>> {
    const response = await this.client.get<unknown>(`/travel-plans/${planId}`);
    return apiOk<TravelPlan>(this.planFromApi(decodeResponse(response.data, legacyTravelPlan, 'GET /travel-plans/{plan_id}')));
  }

  async updatePlan(planId: string, planData: Partial<TravelPlan>): Promise<ApiResponse<TravelPlan>> {
    const response = await this.client.put<unknown>(`/travel-plans/${planId}`, this.planToApi(planData));
    return apiOk<TravelPlan>(this.planFromApi(decodeResponse(response.data, legacyTravelPlan, 'PUT /travel-plans/{plan_id}')));
  }

  async deletePlan(planId: string): Promise<ApiResponse<void>> {
    await this.client.delete<void>(`/travel-plans/${planId}`);
    return apiOkVoid();
  }

  // [Gate R3-12] FR-047 旅程複製。backend(Gate #39)はDB/API実装済みだったが
  // frontendから一切到達不能だった(Gate #25等と同じ「実装済みだが未到達」
  // パターン)。
  async clonePlan(planId: string, data?: { title?: string; start_date?: string }): Promise<ApiResponse<TravelPlan>> {
    const response = await this.client.post<unknown>(`/travel-plans/${planId}/clone`, data ?? {});
    return apiOk<TravelPlan>(this.planFromApi(decodeResponse(response.data, legacyTravelPlan, 'POST /travel-plans/{plan_id}/clone')));
  }

  // [Gate R2-4] POST /quick-drafts/{id}/promote。既存セッション(guest/member)の
  // Authorizationをthis.clientのinterceptorがそのまま付与する(promoteはuser/owner
  // 認証が正式契約のため、これで正しい)。device_tokenはbody側で送る
  // (ADR-quick-draft.md §決定事項3: Authorizationヘッダーはuser/guest認証で
  // 埋まっており、device所有証明を同時に運べないため)。
  async promoteQuickDraft(
    draftId: string,
    deviceToken: string,
    idempotencyKey: string,
    opts?: { target_plan_id?: string; base_revision?: number },
  ): Promise<PromoteQuickDraftResult> {
    const response = await this.client.post(
      `/quick-drafts/${draftId}/promote`,
      { device_token: deviceToken, ...opts },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return decodeResponse(response.data, promoteQuickDraftResult, 'POST /quick-drafts/{draft_id}/promote');
  }

  // 以前はplanStore.tsが/travel-plans(itinerary JSON一括PUT)のみを使い、
  // Gate #29で実装済みのこのAPI群(day/event単位CRUD・並べ替え・Undo・
  // revision/If-Matchによる楽観的並行制御)には一切接続されていなかった。

  async getPlanDetail(planId: string): Promise<ApiResponse<NormalizedPlanDetail>> {
    const response = await this.client.get(`/plans/${planId}`);
    return apiOk<NormalizedPlanDetail>(decodeResponse(response.data, normalizedPlanDetail, 'GET /plans/{plan_id}'));
  }

  async createDay(
    planId: string,
    data: { local_date: string; timezone_id?: string; title?: string; notes?: string },
    idempotencyKey: string
  ): Promise<NormalizedDay> {
    const response = await this.client.post(
      `/plans/${planId}/days`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return decodeResponse(response.data, normalizedDay, 'POST /plans/{plan_id}/days');
  }

  async updateDay(
    planId: string, dayId: string,
    data: { title?: string; notes?: string; sort_order?: number },
    ifMatch: number
  ): Promise<NormalizedDay> {
    const response = await this.client.put(
      `/plans/${planId}/days/${dayId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, normalizedDay, 'PUT /plans/{plan_id}/days/{day_id}');
  }

  async deleteDay(planId: string, dayId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/days/${dayId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/days/{day_id}');
  }

  async createEvent(
    planId: string,
    data: {
      day_id: string; title: string; description?: string; event_type?: string;
      local_start_time?: string; address?: string; latitude?: number; longitude?: number;
      place_id?: string;
    },
    idempotencyKey: string
  ): Promise<NormalizedEvent> {
    const response = await this.client.post(
      `/plans/${planId}/events`, data, { headers: { 'Idempotency-Key': idempotencyKey } }
    );
    return decodeResponse(response.data, normalizedEvent, 'POST /plans/{plan_id}/events');
  }

  async updateEvent(
    planId: string, eventId: string,
    data: Partial<{
      title: string; description: string; event_type: string; local_start_time: string;
      address: string; latitude: number; longitude: number; locked: boolean;
    }>,
    ifMatch: number
  ): Promise<NormalizedEvent> {
    const response = await this.client.put(
      `/plans/${planId}/events/${eventId}`, data, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, normalizedEvent, 'PUT /plans/{plan_id}/events/{event_id}');
  }

  async deleteEvent(planId: string, eventId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.delete(
      `/plans/${planId}/events/${eventId}`, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'DELETE /plans/{plan_id}/events/{event_id}');
  }

  async moveEvent(
    planId: string, eventId: string,
    data: { day_id?: string; sort_order: number },
    ifMatch: number, idempotencyKey: string
  ): Promise<NormalizedEvent> {
    const response = await this.client.post(
      `/plans/${planId}/events/${eventId}/move`, data,
      { headers: { 'If-Match': String(ifMatch), 'Idempotency-Key': idempotencyKey } }
    );
    return decodeResponse(response.data, normalizedEvent, 'POST /plans/{plan_id}/events/{event_id}/move');
  }

  async undoLastPlanChange(planId: string, ifMatch: number): Promise<{ revision: number }> {
    const response = await this.client.post(
      `/plans/${planId}/undo`, {}, { headers: { 'If-Match': String(ifMatch) } }
    );
    return decodeResponse(response.data, revisionResult, 'POST /plans/{plan_id}/undo');
  }
}
