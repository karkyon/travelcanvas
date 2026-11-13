/**
 * [Gate Remaining-2] 無料の外部サービス(気象庁の警報・注意報、逆ジオコーディング、祝日)と鍵が要る提供元の接続口の API。
 *
 * 最初に読む JS を小さく保つため(scripts/ci/check_bundle_budget.py)、CompleteTravelAPI には足さず、使う画面
 * (どれも後から読む塊)がここを直接 import する(g5.ts と同じ形)。失敗は画面の中で案内する(SILENT)。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import { arrayOf, bool, decodeResponse, nullable, num, object, oneOf, str, type Decoder } from './decode';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };

// ===== 外部状況(FR-030)
export type WarningLevel = 'special' | 'warning' | 'advisory';
export interface ExternalWarning { code: string; name: string; level: WarningLevel; status: string; disruptive: boolean }
export interface ExternalWeather {
  day_id: string; local_date: string; office: string; office_name: string | null; report_at: string | null;
  area_name: string | null; warnings: ExternalWarning[]; source: string;
}
export interface ExternalTransit {
  railway: string; status: string; text: string; observed_at: string | null; source: string;
  suggested_kind: 'delay' | 'cancellation'; event_ids: string[];
}
export interface ExternalStatus {
  plan_id: string; server_time: string | null; can_edit: boolean;
  days: { day_id: string; local_date: string }[];
  weather: ExternalWeather[]; transit: ExternalTransit[];
  providers: { jma: { enabled: boolean; source: string }; odpt: { configured: boolean; source: string } };
  unavailable: string[];
}

const externalStatus: Decoder<ExternalStatus> = object<ExternalStatus>({
  plan_id: str, server_time: nullable(str), can_edit: bool,
  days: arrayOf(object({ day_id: str, local_date: str })),
  weather: arrayOf(object<ExternalWeather>({
    day_id: str, local_date: str, office: str, office_name: nullable(str), report_at: nullable(str),
    area_name: nullable(str), source: str,
    warnings: arrayOf(object<ExternalWarning>({
      code: str, name: str, level: oneOf('special', 'warning', 'advisory'), status: str, disruptive: bool,
    })),
  })),
  transit: arrayOf(object<ExternalTransit>({
    railway: str, status: str, text: str, observed_at: nullable(str), source: str,
    suggested_kind: oneOf('delay', 'cancellation'), event_ids: arrayOf(str),
  })),
  providers: object({
    jma: object({ enabled: bool, source: str }), odpt: object({ configured: bool, source: str }),
  }),
  unavailable: arrayOf(str),
});

export async function getExternalStatus(planId: string): Promise<ExternalStatus> {
  return decodeResponse((await api.get(`/plans/${planId}/alerts/external`, SILENT)).data, externalStatus,
    'GET /plans/{plan_id}/alerts/external');
}

// ===== Atlas の地名(FR-052)
export type AtlasState = 'PLANNED' | 'PASS_THROUGH' | 'VISITED' | 'STAYED';
export interface AtlasMunicipality { name: string; state: AtlasState; cells: number }
export interface AtlasRegion { name: string; state: AtlasState; cells: number; municipalities: AtlasMunicipality[] }
export interface AtlasCountry { country_code: string; country: string; state: AtlasState; cells: number; regions: AtlasRegion[] }
export interface AtlasPlaces {
  year: number | null; countries: AtlasCountry[];
  visited: { countries: number; regions: number; municipalities: number };
  pending: number; unresolved: number; enabled: boolean; sources: string;
}
const atlasState = oneOf('PLANNED', 'PASS_THROUGH', 'VISITED', 'STAYED');
const atlasPlaces: Decoder<AtlasPlaces> = object<AtlasPlaces>({
  year: nullable(num),
  countries: arrayOf(object<AtlasCountry>({
    country_code: str, country: str, state: atlasState, cells: num,
    regions: arrayOf(object<AtlasRegion>({
      name: str, state: atlasState, cells: num,
      municipalities: arrayOf(object<AtlasMunicipality>({ name: str, state: atlasState, cells: num })),
    })),
  })),
  visited: object({ countries: num, regions: num, municipalities: num }),
  pending: num, unresolved: num, enabled: bool, sources: str,
});

export async function getAtlasPlaces(year: number | null): Promise<AtlasPlaces> {
  const params = year ? { year } : {};
  return decodeResponse((await api.get('/atlas/places', { ...SILENT, params })).data, atlasPlaces, 'GET /atlas/places');
}

// ===== 祝日(FR-008)
export interface PlanHolidayDay { day_id: string; local_date: string; country_code: string | null; holiday: string | null }
const planHolidays: Decoder<{ plan_id: string; days: PlanHolidayDay[] }> = object({
  plan_id: str,
  days: arrayOf(object<PlanHolidayDay>({
    day_id: str, local_date: str, country_code: nullable(str), holiday: nullable(str),
  })),
});

export async function getPlanHolidays(planId: string): Promise<PlanHolidayDay[]> {
  return decodeResponse((await api.get(`/plans/${planId}/holidays`, SILENT)).data, planHolidays,
    'GET /plans/{plan_id}/holidays').days;
}

// ===== 時刻表・運賃の候補(FR-014・FR-015・FR-017。鍵がある時だけ)
export interface TimetableLeg {
  mode: string; line: string | null; from_label: string | null; to_label: string | null;
  departure_at: string | null; arrival_at: string | null; duration_minutes: number | null;
}
export interface TimetableCandidate {
  total_duration_minutes: number | null; transfer_count: number | null; total_cost: number | null;
  currency: string | null; walking_minutes: number | null; legs: TimetableLeg[]; source: string;
}
export interface TimetableResult {
  configured: boolean; available: boolean; candidates: TimetableCandidate[]; source: string; message: string | null;
}
const timetableResult: Decoder<TimetableResult> = object<TimetableResult>({
  configured: bool, available: bool, source: str, message: nullable(str),
  candidates: arrayOf(object<TimetableCandidate>({
    total_duration_minutes: nullable(num), transfer_count: nullable(num), total_cost: nullable(num),
    currency: nullable(str), walking_minutes: nullable(num), source: str,
    legs: arrayOf(object<TimetableLeg>({
      mode: str, line: nullable(str), from_label: nullable(str), to_label: nullable(str),
      departure_at: nullable(str), arrival_at: nullable(str), duration_minutes: nullable(num),
    })),
  })),
});

export async function searchTimetable(planId: string, input: {
  origin: string; destination: string; date: string; time?: string; arrive_by?: boolean;
}): Promise<TimetableResult> {
  return decodeResponse((await api.post(`/plans/${planId}/route-options/timetable-search`, input, SILENT)).data,
    timetableResult, 'POST /plans/{plan_id}/route-options/timetable-search');
}

// ===== [Gate Remaining-3] FR-011 予約メールの転送アドレス
export interface InboundMailInfo {
  configured: boolean; address: string | null; received_count: number; last_received_at: string | null;
  created_at: string | null; daily_limit: number;
}
const inboundMail: Decoder<InboundMailInfo> = object<InboundMailInfo>({
  configured: bool, address: nullable(str), received_count: num, last_received_at: nullable(str),
  created_at: nullable(str), daily_limit: num,
});

export async function getInboundMail(planId: string): Promise<InboundMailInfo> {
  return decodeResponse((await api.get(`/plans/${planId}/inbound-mail`, SILENT)).data, inboundMail,
    'GET /plans/{plan_id}/inbound-mail');
}

export async function createInboundMail(planId: string): Promise<InboundMailInfo> {
  return decodeResponse((await api.post(`/plans/${planId}/inbound-mail`, null, SILENT)).data, inboundMail,
    'POST /plans/{plan_id}/inbound-mail');
}

export async function revokeInboundMail(planId: string): Promise<InboundMailInfo> {
  return decodeResponse((await api.delete(`/plans/${planId}/inbound-mail`, SILENT)).data, inboundMail,
    'DELETE /plans/{plan_id}/inbound-mail');
}
