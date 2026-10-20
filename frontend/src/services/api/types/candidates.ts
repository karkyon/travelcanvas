/**
 * 候補箱(FR-007)・場所の一元管理(FR-008)APIの型
 *
 * [Gate C2] backend/app/api/v1/candidates.py・places.py に対応する。
 */
export type CandidateStatus = 'open' | 'scheduled' | 'dismissed';
export type CandidateSourceKind = 'url' | 'text' | 'manual' | 'search';
export type DuplicateReason = 'same_provider_id' | 'same_name' | 'nearby' | 'same_address' | 'same_url';

export interface PlanCandidateItem {
  id: string;
  title: string;
  note: string | null;
  source_kind: CandidateSourceKind;
  source_url: string | null;
  source_label: string | null;
  provider: string | null;
  retrieved_at: string | null;
  place_id: string | null;
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  priority: number;
  status: CandidateStatus;
  status_label: string;
  scheduled_event_id: string | null;
  merged_into_id: string | null;
  created_by: string;
  created_at: string | null;
  revision: number;
  duplicates: Array<{ id: string; title: string; reasons: DuplicateReason[] }>;
  merged_from: Array<{ id: string; title: string; source_url: string | null; provider: string | null }>;
}

export interface CandidateList {
  plan_id: string;
  items: PlanCandidateItem[];
  counts: Record<CandidateStatus, number>;
  duplicate_pairs: number;
  can_edit?: boolean;
  id?: string;
  event_id?: string;
  place_id?: string;
  plan_revision?: number;
}

export interface CandidateInput {
  title?: string | null;
  note?: string | null;
  source_url?: string | null;
  category?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  priority?: number;
}

export interface CandidatePatch extends Omit<CandidateInput, 'priority' | 'source_url'> {
  priority?: number;
  status?: 'open' | 'dismissed';
}

export interface FieldSourceInfo {
  provider: string;
  label: string;
  source_url: string | null;
  retrieved_at: string | null;
}

export interface OpeningHoursItem {
  day_of_week: number;
  open_time: string;
  close_time: string;
}

export interface PlaceInfo {
  id: string;
  name: string;
  aliases: string[];
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  website: string | null;
  entrance_note: string | null;
  floor: string | null;
  reservation_required: boolean | null;
  price_range: string | null;
  accessibility_note: string | null;
  closed_days: string | null;
  note: string | null;
  opening_hours: OpeningHoursItem[];
  sources: Record<string, FieldSourceInfo>;
  events: Array<{ event_id: string; plan_id: string; plan_title: string; title: string; date: string | null; local_start_time: string | null }>;
  revision: number;
  can_edit: boolean;
  updated_at: string | null;
}

export type PlacePatch = Partial<Omit<PlaceInfo, 'id' | 'opening_hours' | 'sources' | 'events' | 'revision' | 'can_edit' | 'updated_at'>>;

export interface PlanPlaces {
  plan_id: string;
  places: Array<{ id: string; name: string; category: string | null; address: string | null; phone: string | null; has_opening_hours: boolean; event_count: number }>;
}
