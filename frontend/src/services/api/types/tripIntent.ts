/**
 * [Gate G11] 行き先が未定の旅行相談の型(docs/ux/G11_UIUX全範囲_実装仕様.md §2.5・§3.5)。
 * backend/app/api/v1/trip_intents.py・app/services/trip_intent.py。
 */
/** [Gate ConsultAI] 'ai': AI の読み取り(未確認。確かめるまで条件に使わない) */
export type IntentSource = 'user_input' | 'text' | 'unspecified' | 'ai';
export type IntentStrength = 'required' | 'preferred' | 'undecided';

export interface IntentQuestion {
  id: 'one_way_strength' | 'budget_scope' | 'party_size';
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

/** [Gate AreaLogic] 比べる方面。user_input = 利用者が挙げた行き先、proposed = 条件から内蔵の候補表で選んだ方面 */
export interface ExtractedArea {
  name: string;
  source: 'user_input' | 'proposed';
  reason?: string;
  hours?: number;
  km?: number;
  label?: string;
}
/** [Gate AreaLogic] 地域の語(関西・東海・北陸…)。行き先ではなく範囲の条件 */
export interface RegionHint { word: string; prefectures: string[] }
export interface AreaProposal { status: string; note: string | null; limit_hours: number | null; count: number }

export interface IntentExtraction {
  items: IntentItem[];
  areas: ExtractedArea[];
  regions?: RegionHint[];
  proposal?: AreaProposal;
  nights: number | null;
  extractor: string;
  ai_connected: boolean;
}

export interface ExtractInput {
  text: string;
  origin?: string;
  travel_window?: string;
  date_status?: 'window' | 'fixed';
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
  /** [Gate AreaGeo] 照会した位置が出発地から遠すぎる(同じ名前の別の場所の疑い)。地図に置かない */
  suspect?: boolean;
  suspect_note?: string;
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
  /** [Gate ConsultAI] 予算の対象・期間・上限か目安か(旅行全体の額を宿泊費にしない) */
  budget_target: BudgetTarget;
  budget_period: BudgetPeriod;
  budget_kind: BudgetKind;
  date_status: 'undecided' | 'window' | 'fixed';
  travel_window: string | null;
  preferences: string[];
  /** [Gate ConsultAI] 決まった項目に分けられない希望(その他) */
  notes: string[];
  /** [Gate F07] 確かめた予算の全て(額・全員か1人あたりか・何人分か・対象・期間・上限か目安か) */
  budgets?: Array<{ min_yen: number | null; max_yen: number | null; unit: 'total' | 'per_person' | 'undecided';
    people: number | null; target: string; period: string; kind: string }>;
}

export type BudgetTarget = 'lodging' | 'transport' | 'food' | 'trip_total' | 'other' | 'undecided';
export type BudgetPeriod = 'per_night' | 'all_nights' | 'whole_trip' | 'undecided';
export type BudgetKind = 'cap' | 'guide' | 'undecided';

export interface DraftInput {
  area: { name: string; latitude: number | null; longitude: number | null; provider: 'nominatim' | null;
    retrieved_at: string | null };
  intent: IntentPayload;
  search_candidate_ids: string[];
  /** [Gate SearchUAT] 選んだ Google の場所(place ID と Google マップの URL だけ。名前・住所・位置は送らない・保存しない) */
  google_places?: Array<{ place_id: string; maps_uri: string | null }>;
  source_urls: string[];
  /** [Gate ConsultAI] AI・Google を使った相談(使った額・回数を旅行の枠へ移す) */
  consult_session_id?: string;
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
