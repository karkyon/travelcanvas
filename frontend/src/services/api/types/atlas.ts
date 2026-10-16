/**
 * Personal Travel Atlas(FR-052)APIの型
 *
 * [Gate P15] backend/app/api/v1/atlas.py・app/services/atlas.py に対応する。
 * 参加している旅行を横断して、訪れた地域を緯度・経度の区画で集計する(本人だけが見る)。
 */
export type AtlasPrecision = 'region' | 'area';
export type AtlasState = 'STAYED' | 'VISITED' | 'PASS_THROUGH' | 'PLANNED';

export interface AtlasCell {
  key: string;
  lat_min: number;
  lat_max: number;
  lng_min: number;
  lng_max: number;
  state: AtlasState;
  first_at: string | null;
  last_at: string | null;
  trips: Array<{ plan_id: string; title: string }>;
  evidence: Partial<Record<'actual' | 'memory' | 'track' | 'planned', number>>;
}

export interface AtlasResponse {
  precision: AtlasPrecision;
  year: number | null;
  years: number[];
  plans: Array<{ plan_id: string; title: string; excluded: boolean; observations: number; is_owner: boolean }>;
  cells: AtlasCell[];
  summary: {
    cells: number;
    by_state: Record<AtlasState, number>;
    visited_cells: number;
    revisit_rate: number | null;
    algorithm_version: string;
  };
}
