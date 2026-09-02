import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useSearch } from '../hooks/useSearch';
import { useToast } from './common/Toast';
import Button from './common/Button';
import Input from './common/Input';
import Card from './common/Card';
import { LoadingSpinner } from './common/LoadingSpinner';
import type { Spot, SearchSpotParams } from '../types';

interface SpotSearchProps {
  onSpotSelect?: (spot: Spot) => void;
  onResultsChange?: (results: Spot[]) => void;
  className?: string;
  defaultLocation?: { latitude: number; longitude: number };
  showLocationInput?: boolean;
}

interface SearchFilters {
  categories: string[];
  priceRange: string;
  ratingMin: number;
  openNow: boolean;
  radius: number;
}

const SpotSearch: React.FC<SpotSearchProps> = ({
  onSpotSelect,
  onResultsChange,
  className = '',
  defaultLocation,
  showLocationInput = true
}) => {
  const { searchSpots, aiTextSearch, loading, error, clearSearchResults } = useSearch();
  const { addToast } = useToast();
  
  const [query, setQuery] = useState('');
  const [location, setLocation] = useState(defaultLocation || null);
  const [locationInput, setLocationInput] = useState('');
  const [filters, setFilters] = useState<SearchFilters>({
    categories: [],
    priceRange: 'all',
    ratingMin: 0,
    openNow: false,
    radius: 5.0
  });
  const [searchResults, setSearchResults] = useState<Spot[]>([]);
  const [showFilters, setShowFilters] = useState(false);
  const [searchHistory, setSearchHistory] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);

  // カテゴリの定義
  const categories = useMemo(() => [
    { id: 'sightseeing', name: '観光・名所', icon: '🏛️' },
    { id: 'food', name: 'グルメ・レストラン', icon: '🍽️' },
    { id: 'shopping', name: 'ショッピング', icon: '🛍️' },
    { id: 'entertainment', name: 'エンターテイメント', icon: '🎭' },
    { id: 'culture', name: '文化・歴史', icon: '📚' },
    { id: 'nature', name: '自然・公園', icon: '🌳' },
    { id: 'accommodation', name: '宿泊施設', icon: '🏨' },
    { id: 'transport', name: '交通・移動', icon: '🚃' }
  ], []);

  // 検索履歴の読み込み
  useEffect(() => {
    const history = JSON.parse(localStorage.getItem('spotSearchHistory') || '[]');
    setSearchHistory(history);
  }, []);

  // 現在地の取得
  const getCurrentLocation = useCallback(async () => {
    if (!navigator.geolocation) {
      addToast({
        type: 'error',
        message: 'お使いのブラウザは位置情報をサポートしていません'
      });
      return;
    }

    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 300000 // 5分間のキャッシュ
        });
      });

      const newLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };

      setLocation(newLocation);
      setLocationInput('現在地');
      
      addToast({
        type: 'success',
        message: '現在地を取得しました'
      });
      
    } catch (error) {
      console.error('位置情報取得エラー:', error);
      addToast({
        type: 'error',
        message: '現在地の取得に失敗しました。手動で場所を入力してください。'
      });
    }
  }, [addToast]);

  // 検索実行
  const handleSearch = useCallback(async (useAI: boolean = false) => {
    if (!query.trim()) {
      addToast({
        type: 'warning',
        message: '検索キーワードを入力してください'
      });
      return;
    }

    try {
      const searchParams: SearchSpotParams = {
        query: query.trim(),
        location: location || undefined,
        radius: filters.radius,
        max_results: 20,
        price_level: filters.priceRange === 'all' ? undefined : filters.priceRange,
        min_rating: filters.ratingMin > 0 ? filters.ratingMin : undefined
      };

      // カテゴリフィルターの追加
      if (filters.categories.length > 0) {
        searchParams.category = filters.categories[0]; // 単一カテゴリのみサポート
      }

      let results: Spot[] = [];

      if (useAI) {
        // AI検索を使用
        const aiParams = {
          query: query.trim(),
          location,
          radius: filters.radius,
          filters: {
            categories: filters.categories,
            price_range: filters.priceRange === 'all' ? undefined : filters.priceRange,
            rating_min: filters.ratingMin > 0 ? filters.ratingMin : undefined,
            open_now: filters.openNow
          },
          max_results: 20,
          include_ai_suggestions: true
        };

        const aiResult = await aiTextSearch(aiParams);
        results = aiResult.spots;
      } else {
        // 基本検索を使用
        results = await searchSpots(searchParams);
      }

      setSearchResults(results);
      onResultsChange?.(results);

      // 検索履歴に追加
      const updatedHistory = [query, ...searchHistory.filter(h => h !== query)].slice(0, 10);
      setSearchHistory(updatedHistory);
      localStorage.setItem('spotSearchHistory', JSON.stringify(updatedHistory));

      addToast({
        type: 'success',
        message: `${results.length}件のスポットが見つかりました`
      });

    } catch (err) {
      console.error('検索エラー:', err);
      addToast({
        type: 'error',
        message: '検索に失敗しました。もう一度お試しください。'
      });
    }
  }, [query, location, filters, searchSpots, aiTextSearch, onResultsChange, searchHistory, addToast]);

  // カテゴリフィルターの切り替え
  const toggleCategory = useCallback((categoryId: string) => {
    setFilters(prev => ({
      ...prev,
      categories: prev.categories.includes(categoryId)
        ? prev.categories.filter(id => id !== categoryId)
        : [...prev.categories, categoryId]
    }));
  }, []);

  // フィルターリセット
  const resetFilters = useCallback(() => {
    setFilters({
      categories: [],
      priceRange: 'all',
      ratingMin: 0,
      openNow: false,
      radius: 5.0
    });
  }, []);

  // 検索結果クリア
  const clearResults = useCallback(() => {
    setSearchResults([]);
    clearSearchResults();
    setQuery('');
  }, [clearSearchResults]);

  // 検索候補の処理
  const handleSuggestionClick = useCallback((suggestion: string) => {
    setQuery(suggestion);
    setShowSuggestions(false);
  }, []);

  // 価格レベルの表示
  const getPriceLevelDisplay = useCallback((level: string) => {
    const levels = {
      'low': '💰 リーズナブル',
      'medium': '💰💰 普通',
      'high': '💰💰💰 高級',
      'luxury': '💰💰💰💰 超高級'
    };
    return levels[level as keyof typeof levels] || level;
  }, []);

  return (
    <div className={`space-y-6 ${className}`}>
      {/* 検索フォーム */}
      <Card variant="outlined" padding="lg">
        <div className="space-y-4">
          {/* メイン検索バー */}
          <div className="relative">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="東京タワー、浅草寺、美味しいラーメン店など..."
              leftIcon={
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clipRule="evenodd" />
                </svg>
              }
              onKeyPress={(e) => {
                if (e.key === 'Enter') {
                  handleSearch(false);
                }
              }}
              onFocus={() => setShowSuggestions(true)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              fullWidth
            />
            
            {/* 検索候補 */}
            {showSuggestions && searchHistory.length > 0 && (
              <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-10 mt-1">
                <div className="p-2">
                  <div className="text-xs text-gray-500 mb-2">検索履歴</div>
                  {searchHistory.map((item, index) => (
                    <button
                      key={index}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-gray-100 rounded"
                      onClick={() => handleSuggestionClick(item)}
                    >
                      🕐 {item}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 位置情報入力 */}
          {showLocationInput && (
            <div className="flex gap-3">
              <Input
                value={locationInput}
                onChange={(e) => setLocationInput(e.target.value)}
                placeholder="東京駅、渋谷、現在地など..."
                leftIcon={
                  <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                  </svg>
                }
                className="flex-1"
              />
              <Button
                variant="outline"
                onClick={getCurrentLocation}
                disabled={loading}
              >
                現在地
              </Button>
            </div>
          )}

          {/* カテゴリボタン */}
          <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
            {categories.map((category) => (
              <button
                key={category.id}
                onClick={() => toggleCategory(category.id)}
                className={`
                  p-3 text-center border rounded-lg transition-all duration-200
                  ${filters.categories.includes(category.id)
                    ? 'border-blue-500 bg-blue-50 text-blue-700'
                    : 'border-gray-200 hover:border-gray-300 text-gray-600'
                  }
                `}
              >
                <div className="text-lg mb-1">{category.icon}</div>
                <div className="text-xs font-medium">{category.name}</div>
              </button>
            ))}
          </div>

          {/* 検索ボタンとフィルターボタン */}
          <div className="flex gap-3">
            <Button
              variant="primary"
              onClick={() => handleSearch(false)}
              loading={loading}
              disabled={!query.trim()}
              className="flex-1"
            >
              検索
            </Button>
            
            <Button
              variant="secondary"
              onClick={() => handleSearch(true)}
              loading={loading}
              disabled={!query.trim()}
              leftIcon={
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              }
            >
              AI検索
            </Button>
            
            <Button
              variant="outline"
              onClick={() => setShowFilters(!showFilters)}
            >
              フィルター
            </Button>
            
            {searchResults.length > 0 && (
              <Button
                variant="ghost"
                onClick={clearResults}
              >
                クリア
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* 詳細フィルター */}
      {showFilters && (
        <Card>
          <Card.Header title="詳細フィルター" />
          <Card.Body>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* 価格帯 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  価格帯
                </label>
                <select
                  value={filters.priceRange}
                  onChange={(e) => setFilters(prev => ({ ...prev, priceRange: e.target.value }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="all">すべて</option>
                  <option value="low">リーズナブル</option>
                  <option value="medium">普通</option>
                  <option value="high">高級</option>
                  <option value="luxury">超高級</option>
                </select>
              </div>

              {/* 評価 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  最低評価
                </label>
                <select
                  value={filters.ratingMin}
                  onChange={(e) => setFilters(prev => ({ ...prev, ratingMin: Number(e.target.value) }))}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value={0}>指定なし</option>
                  <option value={3}>⭐ 3.0以上</option>
                  <option value={3.5}>⭐ 3.5以上</option>
                  <option value={4}>⭐ 4.0以上</option>
                  <option value={4.5}>⭐ 4.5以上</option>
                </select>
              </div>

              {/* 検索範囲 */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  検索範囲 ({filters.radius}km)
                </label>
                <input
                  type="range"
                  min="0.5"
                  max="50"
                  step="0.5"
                  value={filters.radius}
                  onChange={(e) => setFilters(prev => ({ ...prev, radius: Number(e.target.value) }))}
                  className="w-full"
                />
              </div>

              {/* 営業中のみ */}
              <div>
                <label className="flex items-center space-x-2">
                  <input
                    type="checkbox"
                    checked={filters.openNow}
                    onChange={(e) => setFilters(prev => ({ ...prev, openNow: e.target.checked }))}
                    className="rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700">現在営業中のみ</span>
                </label>
              </div>
            </div>

            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={resetFilters}>
                フィルターリセット
              </Button>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 検索結果 */}
      {searchResults.length > 0 && (
        <Card>
          <Card.Header 
            title={`検索結果 (${searchResults.length}件)`}
            action={
              <Button variant="outline" size="sm" onClick={clearResults}>
                クリア
              </Button>
            }
          />
          <Card.Body>
            <div className="space-y-4">
              {searchResults.map((spot, index) => (
                <div
                  key={spot.id || index}
                  className="p-4 border border-gray-200 rounded-lg hover:bg-gray-50 cursor-pointer transition-colors"
                  onClick={() => onSpotSelect?.(spot)}
                >
                  <div className="flex justify-between items-start">
                    <div className="flex-1">
                      <h5 className="font-medium text-gray-900">{spot.name}</h5>
                      {spot.description && (
                        <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                          {spot.description}
                        </p>
                      )}
                      
                      <div className="flex items-center mt-2 space-x-4 text-sm text-gray-600">
                        {spot.category && (
                          <span>
                            {categories.find(c => c.id === spot.category)?.icon || '📍'} 
                            {categories.find(c => c.id === spot.category)?.name || spot.category}
                          </span>
                        )}
                        {spot.rating && (
                          <span>⭐ {spot.rating}</span>
                        )}
                        {spot.price_level && (
                          <span>{getPriceLevelDisplay(spot.price_level)}</span>
                        )}
                        {spot.estimated_duration && (
                          <span>⏱️ {spot.estimated_duration}分</span>
                        )}
                      </div>

                      {spot.location?.address && (
                        <p className="text-sm text-gray-500 mt-1">
                          📍 {spot.location.address}
                        </p>
                      )}
                    </div>
                    
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSpotSelect?.(spot);
                      }}
                    >
                      追加
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </Card.Body>
        </Card>
      )}

      {/* ローディング状態 */}
      {loading && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-8">
              <LoadingSpinner size={32} className="mx-auto mb-3" />
              <p className="text-gray-600">検索中...</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* エラー表示 */}
      {error && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-4 text-red-600">
              <div className="text-2xl mb-2">⚠️</div>
              <p>{error}</p>
            </div>
          </Card.Body>
        </Card>
      )}

      {/* 検索結果なしの場合 */}
      {!loading && !error && searchResults.length === 0 && query && (
        <Card variant="outlined">
          <Card.Body>
            <div className="text-center py-8 text-gray-500">
              <div className="text-4xl mb-2">🔍</div>
              <p>「{query}」に関連するスポットが見つかりませんでした</p>
              <p className="text-sm mt-1">検索条件を変更してお試しください</p>
            </div>
          </Card.Body>
        </Card>
      )}
    </div>
  );
};

export default SpotSearch;