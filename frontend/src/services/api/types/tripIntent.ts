/**
 * [Gate G11] 行き先が未定の旅行相談の型(docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5)。
 * backend/app/api/v1/trip_intents.py・app/services/trip_intent.py。
 */
export type IntentSource = 'user_input' | 'text' | 'unspecified';
export type IntentStrength = 'required' | 'preferred' | 'undecided';

export interface IntentQuestion {
  id: 'one_way_strength' | 'budget_scope';
  text: string;
  options: Array<{ value: string; label: string }>;
  suggested: string | null;
  hint: string | null;
}

export interface IntentItem {
  key: string;
  label: string;
  value: unknown;
  display: string;
  source: IntentSource;
  strength: IntentStrength;
  evidence: string | null;
  question: IntentQuestion | null;
  needs_answer: boolean;
  note: string | null;
  sensitive: boolean;
}

export interface IntentExtraction {
  items: IntentItem[];
  areas: Array<{ name: string; source: 'user_input' }>;
  nights: number | null;
  extractor: string;
  ai_connected: boolean;
}

export interface ExtractInput {
  text: string;
  origin?: string;
  travel_window?: string;
  party_size?: number;
  nights?: number;
  transport?: 'car' | 'public' | 'undecided';
  highway?: boolean;
  one_way_strength?: 'preferred' | 'required' | 'undecided';
  room?: 'same_room' | 'multiple_rooms' | 'undecided';
  budget_scope?: 'total' | 'per_person' | 'undecided';
  preferences?: string[];
  areas?: string[];
}

export interface Geocode {
  status: 'ok' | 'not_found' | 'unavailable' | 'disabled';
  latitude: number | null;
  longitude: number | null;
  label: string | null;
  provider: string | null;
  source_url: string | null;
  retrieved_at: string | null;
}

export interface StatusNote {
  status: string;
  note: string;
}

export interface AreaComparison {
  name: string;
  source: 'user_input';
  geocode: Geocode;
  straight_km: number | null;
  drive: StatusNote;
  limit_check: StatusNote & { lower_bound_hours?: number };
  lodging: StatusNote;
  quietness: StatusNote;
  hours: StatusNote;
}

export interface AreasResult {
  origin: Geocode & { query: string };
  areas: AreaComparison[];
  retrieved_at: string;
  providers: Record<'geocode' | 'route' | 'lodging' | 'crowd' | 'destination_suggestions', string | null>;
}

export interface IntentPayload {
  origin: string | null;
  party_size: number | null;
  nights: number;
  transport: 'car' | 'public' | 'undecided';
  highway: boolean;
  one_way_hours: number | null;
  one_way_strength: 'preferred' | 'required' | 'undecided';
  room: 'same_room' | 'multiple_rooms' | 'undecided';
  budget_min: number | null;
  budget_max: number | null;
  budget_scope: 'total' | 'per_person' | 'undecided';
  date_status: 'undecided' | 'window' | 'fixed';
  travel_window: string | null;
  preferences: string[];
}

export interface DraftInput {
  area: { name: string; latitude: number | null; longitude: number | null; provider: 'nominatim' | null;
    retrieved_at: string | null };
  intent: IntentPayload;
  search_candidate_ids: string[];
  source_urls: string[];
}

export type DraftPart = 'morning' | 'lunch' | 'afternoon' | 'evening' | 'stay';

export interface DraftSlot {
  day: number;
  part: DraftPart;
  candidate_id: string;
}

export interface DraftCandidate {
  id: string;
  title: string;
  category: string | null;
  latitude: number | null;
  longitude: number | null;
  provider: string | null;
  retrieved_at: string | null;
  source_url: string | null;
  source_kind: string;
  status: string;
}

export interface TripDraft {
  plan_id: string;
  title: string;
  revision: number;
  can_edit: boolean;
  area: { name: string; latitude: number | null; longitude: number | null; provider: string | null;
    retrieved_at: string | null } | null;
  intent: Record<string, unknown>;
  nights: number;
  days: Array<{ day: number; label: string; parts: Array<{ id: DraftPart; label: string }> }>;
  slots: DraftSlot[];
  candidates: DraftCandidate[];
  committed_at: string | null;
  checklist: Record<'places' | 'lodging' | 'route' | 'hours', { status: string; count?: number }>;
}
