/**
 * 統合検索・Place取得APIの型
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import type { ApiResponse } from './common';

// 検索関連の詳細型定義（optimized版から追加）
export interface SearchPreferences {
  preferredArea: {
    name: string;
    latitude: number;
    longitude: number;
    radius: number;
  };
  interests: {
    nature: number;
    culture: number;
    food: number;
    shopping: number;
    entertainment: number;
    sports: number;
    relaxation: number;
    nightlife: number;
  };
  searchSettings: {
    maxResults: number;
    maxDistance: number;
    pricePreference: string;
    travelStyle: string;
    duration: string;
  };
}

export interface SpotResult {
  id: string;
  name: string;
  description: string;
  category: string;
  location: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  rating?: number;
  price_level?: string;
  distance_km?: number;
  // [Gate #31] 実際の取得元(provider名+URL)。フロントエンドが捏造した
  // 出典("Google Maps"等)は含まない。
  web_sources: string[];
  ai_confidence?: number;
  ai_relevance_score?: number;
  interest_match_score?: number;
  geographic_score?: number;
  estimated_duration?: number;
  estimated_cost?: number;
  // [Gate #31] このスポットが由来する検索候補ID。/search/candidates/{id}/adopt
  // で正規のPlaceへ変換できる。
  candidate_id?: string;
  provider?: string;
}

export interface SearchRequest {
  query: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  max_results?: number;
}

export interface SearchResponse extends ApiResponse {
  data: {
    spots: SpotResult[];
    total_count: number;
    search_metadata: {
      query: string;
      search_type: string;
      api_sources: string[];
      location_considered: boolean;
      user_preferences_applied: boolean;
      ranking_factors: string[];
      confidence?: number;
    };
    user_preferences?: {
      max_results: number;
      max_distance: number;
      travel_style: string;
      top_interests: string[];
    };
  };
}

// [Gate M2改訂] Place端点選択UI用。GET /search/places/{place_id}(Gate #31)の
// レスポンス型。Placeはplanに属さないグローバルなエンティティ。
export interface PlaceDetail {
  id: string;
  name: string;
  category?: string | null;
  location: { latitude?: number | null; longitude?: number | null; address?: string | null };
}

// [Gate M9-FE-A2] searchByImage/searchByVoiceは対応するbackend実装が
// 存在しないため常に空のspots/total_countのみを返す(架空データは返さない、
// Gate #31.5B参照)。呼び出し元(hooks/useSearch.tsx・pages/SearchPage.tsx)
// は将来実装予定だった image_analysis/speech_recognition/search_metadata/
// transcribed_text 系のフィールドにoptional chainingで触れているが、
// これらは現状のbackendから一切返らないため常にundefinedのままで、
// 挙動は本Gate前後で変化しない。呼び出し元の当該コードパス自体の要否は
// 別Gateで再監査する。
export interface UnavailableSearchResult {
  spots: SpotResult[];
  total_count: number;
  error_code: string;
  search_metadata?: Record<string, unknown>;
  image_analysis?: {
    detected_objects?: string[];
    overall_confidence?: number;
  };
  transcribed_text?: string;
  speech_recognition?: {
    transcribed_text?: string;
    confidence?: number;
    audio_duration?: number;
  };
}

// [Gate M9-FE-A2] searchByVoice()の第2引数の形状。aiAPI.searchByVoice/
// 便利関数searchByVoiceからも同じ形状を参照する。
export interface VoiceSearchRequestData {
  location?: { latitude: number; longitude: number };
  language?: string;
  max_results?: number;
}
