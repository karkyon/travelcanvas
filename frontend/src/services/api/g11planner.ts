/**
 * [Gate G11] 旅程の画面の営業時間の照合(GET /plans/{id}/hours-check、backend/app/api/v1/hours_check.py)。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, int, nullable, object, oneOf, record, str, type Decoder } from './decode';
import type { DayHoursCheck, EventHoursCheck } from './types/g11planner';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

export const HOURS_STATUSES = ['ok', 'near_close', 'last_entry', 'last_order', 'closes_during', 'closed', 'unknown'] as const;

const eventHours: Decoder<EventHoursCheck> = object<EventHoursCheck>({
  event_id: str, place_id: nullable(str), status: oneOf(...HOURS_STATUSES), reason: str, local_date: nullable(str),
  window_label: nullable(str), windows: arrayOf(str), hours_source: nullable(str), last_entry: nullable(str),
  last_order: nullable(str), closes_at: nullable(str), minutes_to_close: nullable(int), estimated: bool, stale: bool,
  source: nullable(record),
});

const dayHours: Decoder<DayHoursCheck> = object<DayHoursCheck>({
  day_id: str, local_date: str, timezone_id: str, near_minutes: int, stale_days: int, events: arrayOf(eventHours),
});

export async function getHoursCheck(planId: string, dayId: string): Promise<DayHoursCheck> {
  const r = await api.get(`/plans/${planId}/hours-check`, { ...SILENT, params: { day_id: dayId } });
  return decodeResponse(r.data, dayHours, 'GET /plans/{id}/hours-check');
}
