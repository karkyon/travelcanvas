/**
 * [Gate G9] UX-4 文脈型ダッシュボードの API(GET /dashboard)。最初に読む JS を小さく保つため、ダッシュボードの画面
 * (後から読む塊)がここを直接 import する(g4〜g8 と同じ形)。失敗は画面の中で案内する(共通のエラーの toast を出さない)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { decodeDashboard } from './decodersG9';
import type { DashboardSummary } from './types/g9';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export async function getDashboard(): Promise<DashboardSummary> {
  return decodeDashboard((await api.get('/dashboard', SILENT)).data);
}

/** [Gate HomeV2] 旅行の一覧の状態: 見送り・中止にする(cancelled)/ 日付で決まる状態へ戻す(active) */
export async function setTripState(planId: string, state: 'cancelled' | 'active'): Promise<void> {
  await api.put(`/dashboard/trips/${planId}/state`, { state });
}
