/**
 * スポット一覧コンポーネント
 * 登録済みスポットの表示と管理
 */
import React, { useState, useEffect } from 'react';
import { spotApiService, SpotResponse } from '../services/spotApi';
import Button from './common/Button';
import Card from './common/Card';
import { useToast } from './common/Toast';

interface SpotListProps {
  onSpotSelect?: (spot: SpotResponse) => void;
  refreshTrigger?: number;
}

const SpotList: React.FC<SpotListProps> = ({ onSpotSelect, refreshTrigger }) => {
  const [spots, setSpots] = useState<SpotResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [categories, setCategories] = useState<Array<{ value: string; label: string }>>([]);
  // [Gate #15] お気に入りAPI(backend/app/api/v1/spots.py)を新規実装したのに合わせて追加。
  const [favoriteSpotIds, setFavoriteSpotIds] = useState<Set<string>>(new Set());
  const { addToast } = useToast();
  
  const loadSpots = async () => {
    setIsLoading(true);
    try {
      const spotsData = await spotApiService.getSpots(selectedCategory);
      setSpots(spotsData);
    } catch (error) {
      console.error('スポット読み込みエラー:', error);
      addToast({ 
        message: 'スポットの読み込みに失敗しました', 
        type: 'error' 
      });
    } finally {
      setIsLoading(false);
    }
  };

  const loadFavorites = async () => {
    try {
      const favorites = await spotApiService.getFavorites();
      setFavoriteSpotIds(new Set(favorites.map((f) => f.spot_id)));
    } catch (error) {
      console.error('お気に入り読み込みエラー:', error);
    }
  };

  const toggleFavorite = async (spot: SpotResponse) => {
    const isFavorite = favoriteSpotIds.has(spot.id);
    try {
      if (isFavorite) {
        await spotApiService.removeFavorite(spot.id);
        setFavoriteSpotIds((prev) => {
          const next = new Set(prev);
          next.delete(spot.id);
          return next;
        });
        addToast({ message: 'お気に入りを解除しました', type: 'success' });
      } else {
        await spotApiService.addFavorite(spot.id);
        setFavoriteSpotIds((prev) => new Set(prev).add(spot.id));
        addToast({ message: 'お気に入りに追加しました', type: 'success' });
      }
    } catch (error) {
      console.error('お気に入り更新エラー:', error);
      addToast({
        message: error instanceof Error ? error.message : 'お気に入りの更新に失敗しました',
        type: 'error'
      });
    }
  };
  
  const loadCategories = async () => {
    try {
      const response = await spotApiService.getCategories();
      setCategories([
        { value: 'all', label: 'すべて' },
        ...response.categories
      ]);
    } catch (error) {
      console.error('カテゴリ読み込みエラー:', error);
    }
  };
  
  useEffect(() => {
    loadCategories();
    loadFavorites();
  }, []);
  
  useEffect(() => {
    loadSpots();
  }, [selectedCategory, refreshTrigger]);
  
  const handleDeleteSpot = async (spotId: string) => {
    if (!confirm('このスポットを削除しますか？')) {
      return;
    }
    
    try {
      await spotApiService.deleteSpot(spotId);
      addToast({ message: 'スポットを削除しました', type: 'success' });
      loadSpots(); // リロード
    } catch (error) {
      console.error('スポット削除エラー:', error);
      addToast({ 
        message: error instanceof Error ? error.message : 'スポットの削除に失敗しました', 
        type: 'error' 
      });
    }
  };
  
  const getCategoryLabel = (value: string) => {
    const category = categories.find(cat => cat.value === value);
    return category ? category.label : value;
  };
  
  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ja-JP');
  };
  
  return (
    <div className="space-y-6">
      {/* ヘッダーとフィルター */}
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold text-gray-900">登録済みスポット</h2>
        <div className="flex items-center space-x-4">
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {categories.map(cat => (
              <option key={cat.value} value={cat.value}>
                {cat.label}
              </option>
            ))}
          </select>
          <Button onClick={loadSpots} disabled={isLoading}>
            {isLoading ? '読み込み中...' : '更新'}
          </Button>
        </div>
      </div>
      
      {/* スポット一覧 */}
      {isLoading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto"></div>
          <p className="mt-2 text-gray-600">スポットを読み込んでいます...</p>
        </div>
      ) : spots.length === 0 ? (
        <Card>
          <div className="p-8 text-center">
            <p className="text-gray-600">登録されたスポットがありません</p>
            <p className="text-sm text-gray-500 mt-2">新しいスポットを登録してみましょう</p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {spots.map(spot => (
            <Card key={spot.id} className="hover:shadow-lg transition-shadow">
              <div className="p-4">
                {/* 画像 */}
                {spot.image_url && (
                  <div className="mb-4">
                    <img
                      src={spot.image_url}
                      alt={spot.name}
                      className="w-full h-48 object-cover rounded-md"
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                  </div>
                )}
                
                {/* スポット情報 */}
                <div className="mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">
                    {spot.name}
                  </h3>
                  
                  <div className="flex items-center space-x-2 mb-2">
                    <span className="inline-block bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded">
                      {getCategoryLabel(spot.category)}
                    </span>
                    {spot.price_range && (
                      <span className="inline-block bg-green-100 text-green-800 text-xs px-2 py-1 rounded">
                        {spot.price_range}
                      </span>
                    )}
                  </div>
                  
                  {spot.description && (
                    <p className="text-gray-600 text-sm mb-2 line-clamp-2">
                      {spot.description}
                    </p>
                  )}
                  
                  {spot.address && (
                    <p className="text-gray-500 text-xs mb-2">
                      📍 {spot.address}
                    </p>
                  )}
                  
                  <div className="flex justify-between items-center text-xs text-gray-500">
                    <span>👀 {spot.visit_count}回表示</span>
                    <span>{formatDate(spot.created_at)}</span>
                  </div>
                </div>
                
                {/* アクションボタン */}
                <div className="flex justify-between space-x-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onSpotSelect && onSpotSelect(spot)}
                    className="flex-1"
                  >
                    詳細
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleFavorite(spot)}
                    className={favoriteSpotIds.has(spot.id) ? 'text-pink-600 hover:text-pink-700 hover:bg-pink-50' : ''}
                  >
                    {favoriteSpotIds.has(spot.id) ? '★ お気に入り' : '☆ お気に入り'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteSpot(spot.id)}
                    className="text-red-600 hover:text-red-700 hover:bg-red-50"
                  >
                    削除
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
      
    </div>
  );
};

export default SpotList;
