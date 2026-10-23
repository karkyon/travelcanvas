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
  /** [Gate G4] MAP-02 最終入場・ラストオーダー(HH:MM。無ければ閉じる時刻まで) */
  last_entry?: string | null;
  last_order?: string | null;
}

/** [Gate G4] MAP-02 日付ごとの例外の営業(臨時休業・特別営業。その日は曜日の営業時間より優先) */
export interface SpecialHoursItem {
  local_date: string;
  kind: 'closed' | 'open';
  open_time: string | null;
  close_time: string | null;
  last_entry: string | null;
  last_order: string | null;
  note: string | null;
}

/** [Gate G4] MAP-02 入口ごとの地点 */
export interface PlaceEntrance {
  id?: string;
  label: string;
  latitude: number | null;
  longitude: number | null;
  note: string | null;
  accessible: boolean | null;
}

/** [Gate G4] MAP-02 出典ごとの値(値が出典で違う項目だけ) */
export interface SourceHistoryItem {
  value: string | null;
  provider: string;
  label: string;
  source_url: string | null;
  retrieved_at: string | null;
}

/** [Gate G4] MAP-02 その日の実際の営業時間 */
export interface DayHours {
  date: string;
  source: 'special' | 'weekly' | 'unknown';
  closed: boolean;
  note: string | null;
  windows: Array<{ open: string; close: string; crosses_midnight: boolean; last_entry: string | null; last_order: string | null; source: string }>;
  summary: string;
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
  special_hours?: SpecialHoursItem[];
  entrances?: PlaceEntrance[];
  source_history?: Record<string, SourceHistoryItem[]>;
  sources: Record<string, FieldSourceInfo>;
  events: Array<{ event_id: string; plan_id: string; plan_title: string; title: string; date: string | null; local_start_time: string | null }>;
  revision: number;
  can_edit: boolean;
  updated_at: string | null;
}

export type PlacePatch = Partial<Omit<PlaceInfo, 'id' | 'opening_hours' | 'special_hours' | 'entrances' | 'source_history' | 'sources' | 'events' | 'revision' | 'can_edit' | 'updated_at'>>;

export interface PlanPlaces {
  plan_id: string;
  places: Array<{ id: string; name: string; category: string | null; address: string | null; phone: string | null; has_opening_hours: boolean; event_count: number }>;
}
