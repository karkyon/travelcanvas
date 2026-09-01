/**
 * TravelCanvas 型定義
 * 既存コンポーネントで使用される型を定義
 */

// スポット関連の型
export interface Spot {
  id: string;
  name: string;
  description?: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  rating?: number;
  price_range?: string;
  price_level?: string;
  estimated_duration?: number;
  /** AI画像検索由来の類似度スコア(0-1) */
  similarity?: number;
  /** AI検索由来の関連度スコア(0-1) */
  relevance_score?: number;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
  image_url?: string;
  is_public: boolean;
  created_by: string;
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
  category?: string;
  categories?: string[];
  priceRange?: string;
  ratingMin?: number;
  openNow?: boolean;
  radius?: number;
  max_results?: number;
  price_level?: string;
  min_rating?: number;
}

// 画像検索結果
export interface ImageSearchResult {
  suggested_spots: Spot[];
  recognized_objects: Array<{
    name: string;
    confidence: number;
  }>;
}

// 音声検索結果
export interface VoiceSearchResult {
  spots: Spot[];
  transcribed_text?: string;
  confidence?: number;
  audio_duration?: number;
}

// AI推薦
export interface AIRecommendation {
  spot: Spot;
  reason?: string;
  confidence?: number;
}

// ユーザー関連
export interface User {
  id: string;
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

// ============================================================
// 以下、usePlan.tsx / useDragDrop.tsx / useOptimization.tsx /
// useAuth.tsx で使用されているが未定義だった型(TS2305対応)。
// 実際の使用箇所(各hookの参照/代入パターン)から形状を起こした。
// 注意: これらの型が想定するAPIの形(api.get/post等のaxios風呼び出し、
// /travel/plans 等のURL)は、Gate #6で実装した実バックエンド
// (/api/v1/travel-plans/、専用メソッド方式)と一致していない。
// 型定義の追加だけでは実際にAPIを叩いた時に動作しないため、
// api.ts側かこれらhook側のどちらを正とするかは別途判断が必要。
// ============================================================

export interface Coordinates {
  latitude: number;
  longitude: number;
}

export type TransportMode = 'walking' | 'bicycle' | 'car' | 'taxi' | 'bus' | 'train' | 'subway' | 'plane' | 'boat' | 'other';

export type EventCategory = 'accommodation' | 'transportation' | 'activity' | 'dining' | 'shopping' | 'sightseeing' | 'other';

// 旅行スケジュールアイテム(1つの予定)
export interface ScheduleItem {
  id: string;
  spot_id?: string;
  title: string;
  description?: string;
  category: EventCategory;
  start_time?: string;
  end_time?: string;
  duration?: number;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  cost?: number;
  currency?: string;
  priority?: number;
  travel_method?: TransportMode;
  travel_time?: number;
  travel_cost?: number;
  notes?: string;
  booking_info?: Record<string, unknown>;
  contact_info?: Record<string, unknown>;
}

export interface CreateScheduleItemData {
  spot_id?: string;
  title: string;
  description?: string;
  category: EventCategory;
  start_time?: string;
  end_time?: string;
  duration?: number;
  location_name?: string;
  latitude?: number;
  longitude?: number;
  address?: string;
  cost?: number;
  currency?: string;
  priority?: number;
  travel_method?: TransportMode;
  travel_time?: number;
  travel_cost?: number;
  notes?: string;
  booking_info?: Record<string, unknown>;
  contact_info?: Record<string, unknown>;
}

// 旅行日程(1日分)
export interface DaySchedule {
  id: string;
  date?: string;
  events: ScheduleItem[];
}

// 旅行プラン
export interface TravelPlan {
  id: string;
  title: string;
  description?: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  group_size?: number;
  transport_modes?: TransportMode[];
  constraints?: Record<string, unknown>;
  visibility?: 'private' | 'shared_link' | 'public';
  center_coordinates?: Coordinates;
  tags?: string[];
  days: DaySchedule[];
}

export interface CreatePlanData {
  title: string;
  description?: string;
  destination?: string;
  start_date?: string;
  end_date?: string;
  budget?: number;
  group_size?: number;
  transport_modes?: TransportMode[];
  constraints?: Record<string, unknown>;
  visibility?: 'private' | 'shared_link' | 'public';
  center_coordinates?: Coordinates;
  tags?: string[];
}

// ドラッグ&ドロップ
export interface DragDropState {
  isDragging: boolean;
  draggedItems: ScheduleItem[];
  draggedOver: number | null;
  sourceContainer: string | null;
  targetContainer: string | null;
}

export interface DropResult {
  success: boolean;
  action: 'reorder' | 'move' | 'error';
  sourceContainer?: string;
  targetContainer?: string;
  itemId?: string;
  newIndex?: number;
  error?: string;
}

// 最適化
export interface OptimizationRequest {
  optimization_type: 'time_efficient' | 'cost_efficient' | 'balanced' | string;
  constraints?: Record<string, unknown>;
  preferences?: Record<string, unknown>;
}

export interface OptimizationResult {
  status: 'pending' | 'processing' | 'completed' | 'failed';
  job_id?: string;
  optimized_plan?: TravelPlan;
  improvements?: Record<string, unknown>;
  score?: number;
}

export interface OptimizationJob {
  job_id: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  plan_id?: string;
  created_at?: string;
}

export interface OptimizationHistory {
  id: string;
  plan_id?: string;
  optimization_type?: string;
  original?: OptimizationResult;
  optimized?: OptimizationResult;
  created_at?: string;
}

// 認証
export interface LoginCredentials {
  username: string;
  password: string;
}

export interface RegisterData {
  username: string;
  email: string;
  password: string;
}
