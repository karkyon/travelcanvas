/** [Gate G11] 発見・外部の画像・SNS の投稿・予定の写真の型(docs/ux/G11_UIUX全範囲_実装仕様.md §2.2・§2.4・§5) */
export type DiscoverCategory = 'all' | 'food' | 'market' | 'shopping' | 'viewpoint' | 'sightseeing' | 'quiet';

export interface NearbyResult {
  id: string;
  provider: string;
  name: string;
  category: string | null;
  location: { latitude: number | null; longitude: number | null; address: string | null };
  retrieved_at: string | null;
  /** 基点からの大円距離(m)。座標が無ければ null */
  distance_m: number | null;
  within_radius: boolean | null;
  /** 提供元が半径の内を保証するか(OpenStreetMap の近くの検索だけ true) */
  radius_guaranteed: boolean;
}

export interface NearbySearch {
  query: string;
  category: string;
  radius_km: number;
  base: { latitude: number; longitude: number } | null;
  total: number;
  candidates: NearbyResult[];
  /** 応答しなかった提供元(0件と区別する) */
  unavailable_providers?: string[];
}

export interface MediaProviderStatus {
  image_providers: string[];
  social_providers: string[];
}

export interface ExternalImage {
  provider: string;
  provider_id: string;
  title: string | null;
  author: string | null;
  license: string | null;
  license_url: string | null;
  attribution: string | null;
  source_page_url: string | null;
  width: number | null;
  height: number | null;
  mime: string | null;
  retrieved_at: string;
  /** ライセンスが取り込みを許すか(CC0・PD・CC BY・CC BY-SA) */
  importable: boolean;
}

export interface SocialPreview {
  platform: 'youtube' | 'tiktok' | 'instagram' | null;
  status: 'ok' | 'unsupported' | 'unavailable' | 'disabled';
  url: string | null;
  title: string | null;
  author: string | null;
  retrieved_at: string | null;
  reason: string | null;
  /** 取れない時の代わり(url_and_note = URL とメモを出典として保存) */
  fallback: string | null;
  place_suggestions: Array<{
    word: string;
    name: string;
    address: string | null;
    latitude: number | null;
    longitude: number | null;
    provider: string | null;
    confidence: 'low' | 'medium';
  }>;
}

export interface EventImage {
  memory_id: string;
  visibility: 'private' | 'members';
  source: Record<string, unknown> | null;
}
