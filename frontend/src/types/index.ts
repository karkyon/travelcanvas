/**
 * TravelCanvas 型定義
 * 既存コンポーネントで使用される型を定義
 */

// スポット関連の型
export interface Spot {
  id: number;
  name: string;
  description?: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  price_range?: string;
  image_url?: string;
  is_public: boolean;
  created_by: number;
  visit_count: number;
  created_at: string;
  updated_at?: string;
}

// スポット検索パラメータ
export interface SearchSpotParams {
  query: string;
  location?: {
    latitude: number;
    longitude: number;
  };
  categories?: string[];
  priceRange?: string;
  ratingMin?: number;
  openNow?: boolean;
  radius?: number;
}

// 画像検索結果
export interface ImageSearchResult {
  spots: Spot[];
  landmarks: Array<{
    name: string;
    confidence: number;
    location?: {
      latitude: number;
      longitude: number;
    };
  }>;
  suggestions: string[];
}

// ユーザー関連
export interface User {
  id: number;
  username: string;
  email: string;
  is_active: boolean;
  created_at: string;
}

// API レスポンス
export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

// カテゴリ
export interface Category {
  value: string;
  label: string;
}

// 検索フィルター
export interface SearchFilters {
  categories: string[];
  priceRange: string;
  ratingMin: number;
  openNow: boolean;
  radius: number;
}
