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
  /** [Gate PlaceKinds] 場所の種類(神社・寺/城・史跡/博物館/自然/公園/温泉/食事/宿泊…) */
  kind?: string;
  /** [Gate PlaceKinds] 代表画像(Wikipedia の記事の自由なライセンスの画像。upload.wikimedia.org)。無ければ null */
  thumbnail_url?: string | null;
  /** [Gate PlaceKinds] 短い説明(Wikipedia の記事の説明) */
  description?: string | null;
  /** [Gate AreaSpots] AI のおすすめの特色・希望に合う理由(AI が挙げた場所だけ) */
  ai_note?: string | null;
  ai_why?: string | null;
  /** [Gate AreaSpots] 人気の目安(Wikipedia の記事の大きさ)。おすすめ順に使う */
  popularity?: number | null;
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
  /** [Gate SearchUAT] 応答しなかった理由の分類(blocked・rate_limited・timeout・server_error・network・unreadable・provider_timeout) */
  provider_errors?: Record<string, string>;
  /** [Gate SearchUAT F06] 一部だけの結果を返した提供元(処理が途中で止まった。完全な結果ではない) */
  partial_providers?: string[];
  /** [Gate SearchUAT-S3] 429・406 の後の待機の残り(秒)。この間はアプリから送らない */
  provider_retry_after?: Record<string, number>;
  /** [Gate SearchUAT-S3] 保存した結果を使った提供元(外へ送っていない)。stale は提供元の失敗の時の「前の結果」 */
  cached_providers?: Record<string, { age_seconds: number; stale: boolean }>;
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
