import { useState, useCallback } from 'react';
import { api } from '../services/api';
import type { SpotResult } from '../services/api';
import type {
  SearchSpotParams,
  Spot,
  ImageSearchResult,
  VoiceSearchResult,
  AIRecommendation,
} from '../types';

/**
 * 検索結果(SpotResult: Web検索由来、まだDBに永続化されていない)を
 * 画面表示用のSpot型に変換する。
 * is_public/created_by/visit_count/created_at はDB永続化後に確定する
 * 値のため、検索結果の時点では暫定値を入れる。
 */
const spotResultToSpot = (r: SpotResult): Spot => ({
  id: r.id,
  name: r.name,
  description: r.description,
  category: r.category,
  address: r.location?.address,
  latitude: r.location?.latitude,
  longitude: r.location?.longitude,
  location: r.location,
  rating: r.rating,
  price_level: r.price_level,
  estimated_duration: r.estimated_duration,
  is_public: true,
  created_by: '',
  visit_count: 0,
  created_at: new Date().toISOString(),
});

/**
 * useSearch
 *
 * [2026-09-01 Gate #7e] 全面書き換え。
 * 旧実装は usePlan.tsx / useAuth.tsx と同種のバグを抱えていた:
 * 実在しない `api.post(...)`(axios風の汎用呼び出し)と
 * `/travel/search/spots`・`/ai/search/image` 等の実在しないURLを
 * 前提にしていた。
 *
 * 一方 `services/api.ts` の `CompleteTravelAPI` には既に
 * `searchSpots` / `searchByImage` / `searchByVoice` という、
 * 実際に動作する検索実装(WebSearchServiceによるWikipedia/
 * OpenStreetMap/Overpass API検索、無ければ拡張AI検索へフォールバック)
 * が完結して存在していたため、そちらへ委譲する。
 *
 * `getAIRecommendations` / `generateItinerary` は呼び出し元が
 * 存在せず(grep で確認済み)、対応するバックエンド実装も無いため
 * 今回は削除した。
 */
export const useSearch = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<Spot[]>([]);
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation[]>([]);

  // テキスト検索(基本)
  const searchSpots = useCallback(async (params: SearchSpotParams): Promise<Spot[]> => {
    setLoading(true);
    setError(null);

    try {
      const response = await api.searchSpots({
        query: params.query,
        location: params.location,
        max_results: params.max_results,
      });

      const spots = (response.data?.spots ?? []).map(spotResultToSpot);
      setSearchResults(spots);
      return spots;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'スポット検索に失敗しました');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  // AI テキスト検索(現状はsearchSpotsと同じ統合AI検索を利用する)
  const aiTextSearch = useCallback(
    async (params: {
      query: string;
      location?: { latitude: number; longitude: number } | null;
      radius?: number;
      filters?: {
        categories?: string[];
        price_range?: string;
        rating_min?: number;
        open_now?: boolean;
      };
      max_results?: number;
      include_ai_suggestions?: boolean;
    }
  ): Promise<{ spots: Spot[]; search_metadata?: Record<string, unknown> }> => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.searchSpots({
          query: params.query,
          location: params.location ?? undefined,
          max_results: params.max_results,
        });

        const spots = (response.data?.spots ?? []).map(spotResultToSpot);
        setSearchResults(spots);

        return {
          spots,
          search_metadata: response.data?.search_metadata,
        };
      } catch (err) {
        setError(err instanceof Error ? err.message : 'AI検索に失敗しました');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 画像認識検索
  const imageSearch = useCallback(
    async (
      imageFile: File,
      location?: { latitude: number; longitude: number }
    ): Promise<ImageSearchResult> => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.searchByImage(imageFile, location);
        const spots: Spot[] = (response.data?.spots ?? []).map(spotResultToSpot);
        const detectedObjects: string[] = response.data?.image_analysis?.detected_objects ?? [];
        const confidence: number = response.data?.image_analysis?.overall_confidence ?? 0.8;

        const result: ImageSearchResult = {
          suggested_spots: spots,
          recognized_objects: detectedObjects.map((name) => ({ name, confidence })),
        };

        setSearchResults(spots);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : '画像検索に失敗しました');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 音声検索
  const voiceSearch = useCallback(
    async (
      audioBlob: Blob,
      language: string = 'ja',
      location?: { latitude: number; longitude: number }
    ): Promise<VoiceSearchResult> => {
      setLoading(true);
      setError(null);

      try {
        const response = await api.searchByVoice(audioBlob, { language, location });
        const spots: Spot[] = (response.data?.spots ?? []).map(spotResultToSpot);

        const result: VoiceSearchResult = {
          spots,
          transcribed_text: response.data?.speech_recognition?.transcribed_text,
          confidence: response.data?.speech_recognition?.confidence,
          audio_duration: response.data?.speech_recognition?.audio_duration,
        };

        setSearchResults(spots);
        return result;
      } catch (err) {
        setError(err instanceof Error ? err.message : '音声検索に失敗しました');
        throw err;
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // 音声録音機能(Web API使用、バックエンド非依存)
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
        stop: () =>
          new Promise((resolve) => {
            mediaRecorder.onstop = () => {
              const audioBlob = new Blob(audioChunks, { type: 'audio/wav' });
              stream.getTracks().forEach((track) => track.stop());
              resolve(audioBlob);
            };
            mediaRecorder.stop();
          }),
        isRecording: true,
      };
    } catch (err) {
      setError('マイクへのアクセスが許可されていません');
      throw err;
    }
  }, []);

  // 検索履歴の管理(ローカルストレージのみ、バックエンド非依存)
  const addToSearchHistory = useCallback((query: string, results: Spot[]) => {
    const history = JSON.parse(localStorage.getItem('searchHistory') || '[]');
    const newEntry = {
      query,
      resultCount: results.length,
      timestamp: new Date().toISOString(),
    };

    const updatedHistory = [newEntry, ...history.filter((h: { query: string }) => h.query !== query)].slice(0, 10);
    localStorage.setItem('searchHistory', JSON.stringify(updatedHistory));
  }, []);

  const getSearchHistory = useCallback(() => {
    return JSON.parse(localStorage.getItem('searchHistory') || '[]');
  }, []);

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
    startVoiceRecording,
    addToSearchHistory,
    getSearchHistory,
    clearSearchResults,
    clearError: () => setError(null),
  };
};
