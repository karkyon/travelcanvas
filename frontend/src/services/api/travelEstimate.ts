/**
 * [Gate TravelEstimate] 管理者: 移動の見積もりの条件(手段ごとの速さ・待ち・乗り換え など)と試算。
 * backend/app/api/v1/admin_ops.py の /admin/ops/travel-estimate。画面の中で失敗を案内する(共通の toast は出さない)
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, decodeResponse, int, nullable, num, object, optional, record, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export interface TravelEstimateField { mode: string; mode_label: string; key: string; label: string; unit: string; min: number; max: number; default: number }
export interface TravelEstimateVariant { key: string; label: string; distance_km: number; duration_minutes: number; note?: string }
export interface TravelEstimateSample { straight_km: number; mode: string; variants: TravelEstimateVariant[] }
export type TravelEstimateParams = Record<string, Record<string, number>>;
export interface TravelEstimateSettings {
  schema: TravelEstimateField[];
  params: TravelEstimateParams;
  revision: number;
  updated_at: string | null;
  sample_km: number[];
  sample: TravelEstimateSample[];
  note: string;
}

const variant: Decoder<TravelEstimateVariant> = object<TravelEstimateVariant>({
  key: str, label: str, distance_km: num, duration_minutes: num, note: optional(str),
});
const sample: Decoder<TravelEstimateSample> = object<TravelEstimateSample>({ straight_km: num, mode: str, variants: arrayOf(variant) });
const settings: Decoder<TravelEstimateSettings> = object<TravelEstimateSettings>({
  schema: arrayOf(object<TravelEstimateField>({ mode: str, mode_label: str, key: str, label: str, unit: str, min: num, max: num, default: num })),
  params: record as unknown as Decoder<TravelEstimateParams>,
  revision: int, updated_at: nullable(str), sample_km: arrayOf(num), sample: arrayOf(sample), note: str,
});

export async function getTravelEstimate(): Promise<TravelEstimateSettings> {
  const r = await api.get('/admin/ops/travel-estimate', SILENT);
  return decodeResponse(r.data, settings, 'GET /admin/ops/travel-estimate');
}

export async function previewTravelEstimate(params: TravelEstimateParams): Promise<TravelEstimateSample[]> {
  const r = await api.post('/admin/ops/travel-estimate/preview', { params }, SILENT);
  return decodeResponse(r.data, object<{ sample: TravelEstimateSample[] }>({ sample: arrayOf(sample) }),
    'POST /admin/ops/travel-estimate/preview').sample;
}

export async function saveTravelEstimate(params: TravelEstimateParams, reason: string): Promise<TravelEstimateSettings> {
  const r = await api.put('/admin/ops/travel-estimate', { params, reason }, SILENT);
  return decodeResponse(r.data, settings, 'PUT /admin/ops/travel-estimate');
}
