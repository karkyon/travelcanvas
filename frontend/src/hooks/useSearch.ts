/**
 * useSearch カスタムフック
 * 既存のSpotSearchコンポーネントで使用されるフック
 * バックエンドAPIと連携
 */
import { useState, useCallback } from 'react';
import type { Spot, SearchSpotParams, ImageSearchResult } from '../types';

// API Base URL
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.248:8000/api/v1';

interface UseSearchReturn {
  searchSpots: (params: SearchSpotParams) => Promise<Spot[]>;
  aiTextSearch: (query: string) => Promise<Spot[]>;
  imageSearch: (images: File[]) => Promise<ImageSearchResult>;
  loading: boolean;
  error: string | null;
  clearSearchResults: () => void;
}

const getAuthHeaders = (): HeadersInit => {
  const token = localStorage.getItem('access_token');
  return {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` })
  };
};

export const useSearch = (): UseSearchReturn => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const handleError = (error: any) => {
    console.error('Search error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error occurred';
    setError(message);
    throw error;
  };
  
  const searchSpots = useCallback(async (params: SearchSpotParams): Promise<Spot[]> => {
    setLoading(true);
    setError(null);
    
    try {
      const queryParams = new URLSearchParams();
      
      // カテゴリフィルター
      if (params.categories && params.categories.length > 0) {
        queryParams.append('category', params.categories[0]); // 最初のカテゴリのみ
      }
      
      const response = await fetch(`${API_BASE_URL}/spots/?${queryParams}`, {
        method: 'GET',
        headers: getAuthHeaders()
      });
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const spots: Spot[] = await response.json();
      
      // クライアントサイドでの追加フィルタリング
      let filteredSpots = spots;
      
      // クエリによるフィルタリング
      if (params.query) {
        const query = params.query.toLowerCase();
        filteredSpots = filteredSpots.filter(spot => 
          spot.name.toLowerCase().includes(query) ||
          (spot.description && spot.description.toLowerCase().includes(query)) ||
          (spot.address && spot.address.toLowerCase().includes(query))
        );
      }
      
      // 評価によるフィルタリング
      if (params.ratingMin && params.ratingMin > 0) {
        filteredSpots = filteredSpots.filter(spot => 
          spot.rating && spot.rating >= params.ratingMin!
        );
      }
      
      return filteredSpots;
      
    } catch (err) {
      handleError(err);
      return [];
    } finally {
      setLoading(false);
    }
  }, []);
  
  const aiTextSearch = useCallback(async (query: string): Promise<Spot[]> => {
    // AI検索は通常の検索と同様に実装（将来的にAI機能を追加）
    return searchSpots({ query });
  }, [searchSpots]);
  
  const imageSearch = useCallback(async (images: File[]): Promise<ImageSearchResult> => {
    setLoading(true);
    setError(null);
    
    try {
      // 画像検索は将来実装として、現在は空の結果を返す
      console.log('Image search not implemented yet:', images);
      
      // 全スポットを取得して返す（暫定実装）
      const spots = await searchSpots({ query: '' });
      
      return {
        spots: spots.slice(0, 5), // 最初の5件のみ
        landmarks: [],
        suggestions: ['観光地', 'レストラン', '宿泊施設']
      };
      
    } catch (err) {
      handleError(err);
      return {
        spots: [],
        landmarks: [],
        suggestions: []
      };
    } finally {
      setLoading(false);
    }
  }, [searchSpots]);
  
  const clearSearchResults = useCallback(() => {
    setError(null);
  }, []);
  
  return {
    searchSpots,
    aiTextSearch,
    imageSearch,
    loading,
    error,
    clearSearchResults
  };
};
