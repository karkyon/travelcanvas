import { useState, useCallback } from 'react';
import { api } from '../services/api';
import type { 
  SearchSpotParams, 
  Spot, 
  ImageSearchResult,
  VoiceSearchResult,
  AIRecommendation 
} from '../types';

export const useSearch = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Spot[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation[]>([]);

  // テキスト検索
  const searchSpots = useCallback(async (params: SearchSpotParams) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/travel/search/spots', params);
      const results = response.data.data;
      setSearchResults(results);
      return results;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'スポット検索に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // AI テキスト検索（高度検索）
  const aiTextSearch = useCallback(async (params: {
    query: string;
    location?: { latitude: number; longitude: number };
    radius?: number;
    filters?: {
      categories?: string[];
      price_range?: string;
      rating_min?: number;
      open_now?: boolean;
    };
    max_results?: number;
    include_ai_suggestions?: boolean;
  }) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/ai/search/text', params);
      const { spots, query_analysis, search_metadata } = response.data.data;
      
      setSearchResults(spots);
      
      // AI推薦があれば設定
      if (search_metadata.ai_enhanced) {
        setAiRecommendations(spots.filter((spot: any) => spot.ai_confidence > 0.8));
      }
      
      return {
        spots,
        query_analysis,
        search_metadata
      };
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'AI検索に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 画像認識検索
  const imageSearch = useCallback(async (
    imageFile: File,
    location?: { latitude: number; longitude: number },
    maxResults: number = 10
  ): Promise<ImageSearchResult> => {
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('image', imageFile);
      if (location) {
        formData.append('location', JSON.stringify(location));
      }
      formData.append('max_results', maxResults.toString());

      const response = await api.post('/ai/search/image', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = response.data.data;
      setSearchResults(result.suggested_spots || []);
      
      return result;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '画像検索に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 音声検索
  const voiceSearch = useCallback(async (
    audioBlob: Blob,
    language: string = 'ja',
    location?: { latitude: number; longitude: number },
    maxResults: number = 10
  ): Promise<VoiceSearchResult> => {
    setLoading(true);
    setError(null);
    
    try {
      const formData = new FormData();
      formData.append('voice_data', audioBlob, 'voice.wav');
      
      const requestData = {
        language,
        location,
        max_results: maxResults
      };
      formData.append('request_data', JSON.stringify(requestData));

      const response = await api.post('/ai/search/voice', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      });

      const result = response.data.data;
      setSearchResults(result.spots || []);
      
      return result;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '音声検索に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // AI推薦システム
  const getAIRecommendations = useCallback(async (params: {
    user_preferences?: {
      favorite_categories?: string[];
      budget_range?: string;
      activity_level?: string;
    };
    location: { latitude: number; longitude: number };
    travel_style?: string;
    budget_range?: string;
    duration?: number;
    interests?: string[];
  }) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/ai/recommendations', params);
      const { spots, recommendation_metadata } = response.data.data;
      
      setAiRecommendations(spots);
      
      return {
        spots,
        recommendation_metadata
      };
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'AI推薦取得に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // スマート行程生成
  const generateItinerary = useCallback(async (params: {
    destination: string;
    start_date: string;
    end_date: string;
    preferences: {
      budget?: number;
      travel_style?: string;
      interests?: string[];
      pace?: string;
    };
    must_visit?: string[];
    avoid_places?: string[];
  }) => {
    setLoading(true);
    setError(null);
    
    try {
      const response = await api.post('/ai/itinerary/generate', params);
      return response.data.data;
    } catch (err: any) {
      setError(err.response?.data?.error?.message || '行程生成に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // 音声録音機能（Web API使用）
  const startVoiceRecording = useCallback(async (): Promise<{
    stop: () => Promise<Blob>;
    isRecording: boolean;
  }> => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      const audioChunks: Blob[] = [];
      
      mediaRecorder.ondataavailable = (event) => {
        audioChunks.push(event.data);
      };
      
      mediaRecorder.start();
      
      return {
        stop: () => new Promise((resolve) => {
          mediaRecorder.onstop = () => {
            const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
            stream.getTracks().forEach(track => track.stop());
            resolve(audioBlob);
          };
          mediaRecorder.stop();
        }),
        isRecording: true
      };
    } catch (err: any) {
      setError('マイクへのアクセスが許可されていません');
      throw err;
    }
  }, []);

  // 検索履歴の管理
  const addToSearchHistory = useCallback((query: string, results: Spot[]) => {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    const newEntry = {
      query,
      resultCount: results.length,
      timestamp: new Date().toISOString()
    };
    
    // 重複削除と最新10件のみ保持
    const updatedHistory = [newEntry, ...history.filter((h: any) => h.query !== query)].slice(0, 10);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
  }, []);

  // 検索履歴取得
  const getSearchHistory = useCallback(() => {
    return JSON.parse(localStorage.getItem('searchHistory') || '[]');
  }, []);

  // 検索結果クリア
  const clearSearchResults = useCallback(() => {
    setSearchResults([]);
    setAiRecommendations([]);
    setError(null);
  }, []);

  return {
    loading,
    error,
    searchResults,
    aiRecommendations,
    searchSpots,
    aiTextSearch,
    imageSearch,
    voiceSearch,
    getAIRecommendations,
    generateItinerary,
    startVoiceRecording,
    addToSearchHistory,
    getSearchHistory,
    clearSearchResults,
    clearError: () => setError(null)
  };
};