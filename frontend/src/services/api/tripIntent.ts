/**
 * [Gate G11] 行き先が未定の旅行相談の API(docs/ux/G11_UIUX全範囲_実装仕様.md §2.5)。backend/app/api/v1/trip_intents.py。
 * 画面の中で失敗を案内するため、共通のエラーの toast は出さない。
 */
import type { AxiosRequestConfig } from 'axios';
import { api } from './index';
import {
  arrayOf, bool, decodeResponse, int, nullable, num, object, oneOf, optional, record, str, type Decoder,
} from './decode';
import type {
  AreaComparison, AreaImage, AreaProposal, AreasResult, DraftInput, ExtractedArea, ExtractInput, Geocode, IntentExtraction,
  IntentItem, IntentQuestion, RegionHint, StatusNote, TripDraft,
} from './types/tripIntent';

const SILENT: AxiosRequestConfig = { skipGlobalErrorHandler: true };
const anyValue: Decoder<unknown> = (v) => v;

const question: Decoder<IntentQuestion> = object<IntentQuestion>({
  id: oneOf('one_way_strength', 'budget_scope', 'party_size'), text: str,
  options: arrayOf(object<{ value: string; label: string }>({ value: str, label: str })),
  suggested: nullable(str), hint: nullable(str),
});

const item: Decoder<IntentItem> = object<IntentItem>({
  key: str, label: str, value: anyValue, display: str, source: oneOf('user_input', 'text', 'unspecified'),
  strength: oneOf('required', 'preferred', 'undecided'), evidence: nullable(str), question: nullable(question),
  needs_answer: bool, note: nullable(str), sensitive: bool,
});

/** [Gate AreaLogic] 比べる方面・地域の範囲・条件からの選び方(AI の読み取りと共通) */
export const extractedArea: Decoder<ExtractedArea> = object<ExtractedArea>({
  name: str, source: oneOf('user_input', 'proposed', 'ai_proposed'), reason: optional(str), hours: optional(num),
  km: optional(num), label: optional(str), pref: optional(nullable(str)), highlights: optional(str),
  minutes_min: optional(nullable(num)), minutes_max: optional(nullable(num)), summary: optional(str),
  spots: optional(arrayOf(object<{ name: string; kind: string; note: string }>({ name: str, kind: str, note: str }))),
  caution: optional(str),
});
export const regionHint: Decoder<RegionHint> = object<RegionHint>({ word: str, prefectures: arrayOf(str) });
export const areaProposal: Decoder<AreaProposal> = object<AreaProposal>({
  status: str, note: nullable(str), limit_hours: nullable(num), count: int,
});

const extraction: Decoder<IntentExtraction> = object<IntentExtraction>({
  items: arrayOf(item),
  areas: arrayOf(extractedArea), regions: optional(arrayOf(regionHint)), proposal: optional(areaProposal),
  nights: nullable(int), extractor: str, ai_connected: bool,
});

export async function extractIntent(input: ExtractInput): Promise<IntentExtraction> {
  const r = await api.post('/trip-intents/extract', input, SILENT);
  return decodeResponse(r.data, extraction, 'POST /trip-intents/extract');
}

const geocode: Decoder<Geocode> = object<Geocode>({
  status: oneOf('ok', 'not_found', 'unavailable', 'disabled'), latitude: nullable(num), longitude: nullable(num),
  label: nullable(str), provider: nullable(str), source_url: nullable(str), retrieved_at: nullable(str),
  suspect: optional(bool), suspect_note: optional(str),
});
const note: Decoder<StatusNote> = object<StatusNote>({ status: str, note: str });

const area: Decoder<AreaComparison> = object<AreaComparison>({
  name: str, source: oneOf('user_input'), geocode, straight_km: nullable(num), drive: note,
  limit_check: object<AreaComparison['limit_check']>({ status: str, note: str, lower_bound_hours: optional(num) }),
  lodging: note, quietness: note, hours: note,
});

const providerName = nullable(str);
const areas: Decoder<AreasResult> = object<AreasResult>({
  origin: object<AreasResult['origin']>({
    query: str, status: oneOf('ok', 'not_found', 'unavailable', 'disabled'), latitude: nullable(num),
    longitude: nullable(num), label: nullable(str), provider: nullable(str), source_url: nullable(str),
    suspect: optional(bool), suspect_note: optional(str),
    retrieved_at: nullable(str),
  }),
  areas: arrayOf(area), retrieved_at: str,
  providers: object<AreasResult['providers']>({
    geocode: providerName, route: providerName, lodging: providerName, crowd: providerName,
    destination_suggestions: providerName,
  }),
});

/** [Gate AreaImages] 方面の代表画像(Wikipedia・無料)。取れない方面は null */
export async function getAreaImages(names: string[]): Promise<Record<string, AreaImage | null>> {
  const params = new URLSearchParams();
  for (const n of names.slice(0, 10)) params.append('names', n);
  const r = await api.get(`/trip-intents/area-images?${params.toString()}`, SILENT);
  const body = decodeResponse(r.data, object<{ images: Record<string, unknown> }>({ images: record }),
    'GET /trip-intents/area-images');
  const out: Record<string, AreaImage | null> = {};
  for (const [k, v] of Object.entries(body.images)) {
    const img = v as Partial<AreaImage> | null;
    out[k] = img && typeof img.url === 'string' && img.url.startsWith('https://upload.wikimedia.org/')
      && typeof img.page_url === 'string' ? { url: img.url, title: String(img.title ?? k), page_url: img.page_url } : null;
  }
  return out;
}

export async function compareAreas(input: { origin: string; areas: string[]; one_way_hours: number | null;
  one_way_strength: string | null; area_prefs?: Record<string, string> }): Promise<AreasResult> {
  const body = { origin: input.origin, areas: input.areas,
    ...(input.area_prefs && Object.keys(input.area_prefs).length ? { area_prefs: input.area_prefs } : {}),
    ...(input.one_way_hours ? { one_way_hours: input.one_way_hours } : {}),
    ...(input.one_way_strength ? { one_way_strength: input.one_way_strength } : {}) };
  const r = await api.post('/trip-intents/areas', body, SILENT);
  return decodeResponse(r.data, areas, 'POST /trip-intents/areas');
}

export async function createTripDraft(input: DraftInput): Promise<{ plan_id: string; revision: number; candidates: number }> {
  const r = await api.post('/trip-intents/draft', input, SILENT);
  return decodeResponse(r.data, object<{ plan_id: string; revision: number; candidates: number }>({
    plan_id: str, revision: int, candidates: int }), 'POST /trip-intents/draft');
}

const part = oneOf('morning', 'lunch', 'afternoon', 'evening', 'stay');
const draft: Decoder<TripDraft> = object<TripDraft>({
  plan_id: str, title: str, revision: int, can_edit: bool,
  area: nullable(object<NonNullable<TripDraft['area']>>({
    name: str, latitude: nullable(num), longitude: nullable(num), provider: nullable(str), retrieved_at: nullable(str),
  })),
  intent: record, nights: int,
  days: arrayOf(object<TripDraft['days'][number]>({
    day: int, label: str,
    parts: arrayOf(object<TripDraft['days'][number]['parts'][number]>({ id: part, label: str })),
  })),
  slots: arrayOf(object<TripDraft['slots'][number]>({ day: int, part, candidate_id: str })),
  candidates: arrayOf(object<TripDraft['candidates'][number]>({
    id: str, title: str, category: nullable(str), latitude: nullable(num), longitude: nullable(num),
    provider: nullable(str), retrieved_at: nullable(str), source_url: nullable(str), source_kind: str, status: str,
  })),
  committed_at: nullable(str),
  checklist: object<TripDraft['checklist']>({
    places: object<{ status: string; count?: number }>({ status: str, count: optional(int) }),
    lodging: object<{ status: string; count?: number }>({ status: str, count: optional(int) }),
    route: object<{ status: string; count?: number }>({ status: str, count: optional(int) }),
    hours: object<{ status: string; count?: number }>({ status: str, count: optional(int) }),
  }),
});

export async function getTripDraft(planId: string): Promise<TripDraft> {
  const r = await api.get(`/plans/${planId}/trip-intent`, SILENT);
  return decodeResponse(r.data, draft, 'GET /plans/{id}/trip-intent');
}

export async function updateDraftSlots(planId: string, slots: TripDraft['slots'], revision: number): Promise<TripDraft> {
  const r = await api.put(`/plans/${planId}/trip-intent/slots`, { slots }, { ...SILENT, headers: { 'If-Match': String(revision) } });
  return decodeResponse(r.data, draft, 'PUT /plans/{id}/trip-intent/slots');
}

export async function commitTripDraft(planId: string, startDate: string, timezoneId: string, revision: number) {
  const r = await api.post(`/plans/${planId}/trip-intent/commit`, { start_date: startDate, timezone_id: timezoneId },
    { ...SILENT, headers: { 'If-Match': String(revision) } });
  return decodeResponse(r.data, object<{ plan_id: string; revision: number; events: number;
    days: Array<{ id: string; local_date: string }> }>({
    plan_id: str, revision: int, events: int,
    days: arrayOf(object<{ id: string; local_date: string }>({ id: str, local_date: str })),
  }), 'POST /plans/{id}/trip-intent/commit');
}
