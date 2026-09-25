/**
 * 統合検索・候補採用・Place取得(/search/*, /places/*)
 *
 * [Gate M9-FE-C2a] 旧services/api.ts(約92KB・単一ファイル)を責務別に分割したもの。定義本体は分割前から変更していない。
 */
import { AuthApi } from './auth';
import type { ApiResponse, PlaceDetail, SearchRequest, SearchResponse, SpotResult, UnavailableSearchResult, VoiceSearchRequestData } from '../types';

// [Gate M9-FE-A2] POST /search/spots (backend/app/services/search_provider.py)
// が返す個々の生候補の形状。この関数の中でのみ使う内部形状のため非export。
interface SearchCandidateRaw {
  id: string;
  provider: string;
  name: string;
  category?: string;
  location?: { latitude?: number; longitude?: number; address?: string };
}

export class SearchApi extends AuthApi {
  // [Gate #31] 以前はここで webSearchService (frontendから直接
  // Wikipedia/Nominatim/Overpass を叩く実装) を呼び、結果が0件/エラー/
  // レート制限時には3段階のフォールバック(webSearchServiceのMath.random()
  // 生成、実在店舗名を騙るgenerateEnhancedSearchResults、さらに別の
  // Math.random()生成であるgenerateFallbackResults)のいずれかが必ず発火し、
  // 常に「本物らしい」架空の検索結果をユーザーに返していた。
  //
  // 本Gateでbackendの /search/spots へ処理を集約する。backendの
  // search_provider.py は失敗時に空リストを返すのみで、絶対にデータを
  // 捏造しない。0件は0件のまま返す。
  async searchSpots(request: SearchRequest): Promise<SearchResponse> {
    try {
      const response = await this.client.post<{ candidates?: SearchCandidateRaw[] }>('/search/spots', {
        query: request.query,
        latitude: request.location?.latitude,
        longitude: request.location?.longitude,
        max_results: request.max_results || 20,
      });

      const candidates: SearchCandidateRaw[] = response.data?.candidates ?? [];
      const spots: SpotResult[] = candidates.map((c) => ({
        id: c.id,
        candidate_id: c.id,
        provider: c.provider,
        name: c.name,
        // 説明文を捏造せず、取得元を正直に示すのみにとどめる。
        description: `${c.provider}経由で見つかった候補です`,
        category: c.category || 'other',
        location: {
          latitude: c.location?.latitude ?? undefined,
          longitude: c.location?.longitude ?? undefined,
          address: c.location?.address ?? undefined,
        },
        web_sources: [c.provider],
      }));

      return {
        success: true,
        message: `${spots.length}件のスポット候補が見つかりました`,
        data: {
          spots,
          total_count: spots.length,
          search_metadata: {
            query: request.query,
            search_type: 'backend_search_adapter',
            api_sources: ['Wikipedia', 'Nominatim', 'Overpass'],
            location_considered: !!request.location,
            user_preferences_applied: false,
            ranking_factors: [],
          },
        },
      };
    } catch (error) {
      console.error('検索エラー:', error);
      // [Gate #31] エラー時も架空データへフォールバックしない。
      // 失敗を正直に伝え、呼び出し元(useSearch.tsx)がエラー表示する。
      return {
        success: false,
        message: '検索中にエラーが発生しました',
        data: {
          spots: [],
          total_count: 0,
          search_metadata: {
            query: request.query,
            search_type: 'error',
            api_sources: [],
            location_considered: !!request.location,
            user_preferences_applied: false,
            ranking_factors: [],
          },
        },
      };
    }
  }

  // [Gate #32] 検索候補(candidate)を正規のPlaceへ採用する(Gate #31
  // /search/candidates/{id}/adopt)。「旅程に追加」フローで、adopt→
  // createEvent(place_id指定)の順に呼ぶ。
  async adoptCandidate(candidateId: string): Promise<{
    id: string; name: string; category?: string;
    location: { latitude?: number; longitude?: number; address?: string };
  }> {
    const response = await this.client.post(`/search/candidates/${candidateId}/adopt`);
    return response.data;
  }

  // [Gate M2改訂] Segment端点としてPlaceを選択する際、名称表示のために
  // 単体取得する(GET /places/{place_id}、Gate #31)。Placeはplanに属さない
  // グローバルなエンティティのため一覧APIは無く、個別取得のみを提供する。
  async getPlace(placeId: string): Promise<PlaceDetail> {
    const response = await this.client.get<PlaceDetail>(`/places/${placeId}`);
    return response.data;
  }

  // [Gate #31.5B] 監査是正: 以前はファイル名の文字列マッチ(「tower」「寺」
  // 等)だけで「AI画像解析により物体を検出した」と称する架空の結果
  // (detected_objects等)を生成していた。実装が存在しないことを正直に
  // 伝え、架空データは一切返さない。実装され次第この関数を差し替える。
  async searchByImage(
    _file: File, _location?: { latitude: number; longitude: number }
  ): Promise<ApiResponse<UnavailableSearchResult>> {
    void _file;
    void _location;
    return {
      success: false,
      message: 'この機能は現在利用できません(画像からのスポット検索は未実装です)',
      data: { spots: [], total_count: 0, error_code: 'FEATURE_UNAVAILABLE' },
    };
  }

  // [Gate #31.5B] 監査是正: 以前は録音内容を一切解析せず、5つの固定文の
  // 中からMath.random()で1つを選んで「音声認識結果」として返していた
  // (録音内容と無関係な文字起こしがユーザーに表示される実害があった)。
  // 実装が存在しないことを正直に伝え、架空データは一切返さない。
  async searchByVoice(_audioBlob: Blob, _data: VoiceSearchRequestData): Promise<ApiResponse<UnavailableSearchResult>> {
    void _audioBlob;
    void _data;
    return {
      success: false,
      message: 'この機能は現在利用できません(音声からのスポット検索は未実装です)',
      data: { spots: [], total_count: 0, error_code: 'FEATURE_UNAVAILABLE' },
    };
  }
}
