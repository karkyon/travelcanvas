/** [Gate SpotMode] FR-060 スポットモード(backend/app/api/v1/spot_areas.py)の型 */
import type { DayHours } from './candidates';

export type SpotGenre = 'food' | 'cafe' | 'gift' | 'sight' | 'rest' | 'other';
export type SpotPriority = 'want' | 'maybe';

export interface SpotItem {
  id: string;
  candidate_id: string;
  title: string;
  note: string | null;
  category: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  place_id: string | null;
  genre: SpotGenre;
  genre_label: string;
  priority: SpotPriority;
  stay_minutes: number;
  sort_order: number;
  visited_at: string | null;
  visited_by: string | null;
  skipped: boolean;
  wanted_by: string[];
  wanted_by_me: boolean;
  /** 天気への強さ(indoor / outdoor / mixed / unknown 等。weather_fit) */
  fit: string;
  seats: boolean;
  hours_today: DayHours | null;
}

export interface SpotArea {
  id: string;
  title: string;
  day_id: string | null;
  local_date: string | null;
  timezone_id: string | null;
  start_time: string | null;
  end_time: string | null;
  meet_label: string | null;
  meet_time: string | null;
  meet_latitude: number | null;
  meet_longitude: number | null;
  center_latitude: number | null;
  center_longitude: number | null;
  radius_m: number;
  suggest_on_approach: boolean;
  revision: number;
  items: SpotItem[];
  can_edit: boolean;
}

export interface SpotAreaList {
  areas: SpotArea[];
  can_edit: boolean;
  genres: Record<string, string>;
}

export interface SpotAreaItemInput {
  candidate_id: string;
  genre?: SpotGenre;
  priority: SpotPriority;
  stay_minutes: number;
}

export interface SpotAreaInput {
  title: string;
  day_id: string | null;
  start_time: string | null;
  end_time: string | null;
  meet_label: string | null;
  meet_time: string | null;
  meet_latitude: number | null;
  meet_longitude: number | null;
  radius_m?: number | null;
  suggest_on_approach: boolean;
  items: SpotAreaItemInput[];
}

export interface SpotSuggestion {
  title: string;
  center_latitude: number;
  center_longitude: number;
  radius_m: number;
  candidates: Array<{ candidate_id: string; title: string; genre: SpotGenre }>;
}

export type NearbyKind = 'all' | 'toilet' | 'rest' | 'cafe' | 'sweets' | 'food' | 'souvenir' | 'sight' | 'locker';

export interface NearbyResult {
  name: string;
  address: string | null;
  latitude: number;
  longitude: number;
  distance_m: number;
  walk_minutes: number;
  genre: SpotGenre;
  genre_label: string;
  category: string | null;
  fit: string;
  provider: string | null;
  url: string | null;
  in_area: boolean;
}

export interface NearbyResponse {
  kind: NearbyKind;
  results: NearbyResult[];
  sources: string[];
  failed_providers: string[];
  message: string | null;
}
