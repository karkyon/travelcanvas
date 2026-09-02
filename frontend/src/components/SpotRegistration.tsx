/**
 * スポット登録コンポーネント
 * キーワード、地図、画像からスポットを登録
 */
import React, { useState, useEffect } from 'react';
import { spotApiService, SpotData } from '../services/spotApi';
import Button from './common/Button';
import Input from './common/Input';
import Card from './common/Card';
import { useToast } from './common/Toast';

interface SpotRegistrationProps {
  onSpotCreated?: (spot: any) => void;
  onClose?: () => void;
}

const SpotRegistration: React.FC<SpotRegistrationProps> = ({ onSpotCreated, onClose }) => {
  const [formData, setFormData] = useState<Omit<SpotData, 'id'>>({
    name: '',
    description: '',
    category: 'other',
    address: '',
    latitude: undefined,
    longitude: undefined,
    price_range: '',
    image_url: ''
  });
  
  const [categories, setCategories] = useState<Array<{ value: string; label: string }>>([]);
  const [isLoading, setIsLoading] = useState(false);
  const { addToast } = useToast();
  
  // カテゴリ読み込み
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const response = await spotApiService.getCategories();
        setCategories(response.categories);
      } catch (error) {
        console.error('カテゴリ読み込みエラー:', error);
      }
    };
    
    loadCategories();
  }, []);
  
  const handleInputChange = (field: keyof SpotData, value: string | number | undefined) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      addToast({ message: 'スポット名は必須です', type: 'error' });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const newSpot = await spotApiService.createSpot(formData);
      addToast({ message: 'スポットを登録しました！', type: 'success' });
      
      // フォームリセット
      setFormData({
        name: '',
        description: '',
        category: 'other',
        address: '',
        latitude: undefined,
        longitude: undefined,
        price_range: '',
        image_url: ''
      });
      
      // 親コンポーネントに通知
      if (onSpotCreated) {
        onSpotCreated(newSpot);
      }
      
    } catch (error) {
      console.error('スポット作成エラー:', error);
      addToast({ 
        message: error instanceof Error ? error.message : 'スポット登録に失敗しました', 
        type: 'error' 
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <Card className="max-w-2xl mx-auto">
      <div className="p-6">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">新しいスポットを登録</h2>
          {onClose && (
            <Button variant="ghost" onClick={onClose}>
              ✕
            </Button>
          )}
        </div>
        
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* スポット名 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              スポット名 *
            </label>
            <Input
              type="text"
              value={formData.name}
              onChange={(e) => handleInputChange('name', e.target.value)}
              placeholder="例: 東京スカイツリー"
              required
            />
          </div>
          
          {/* カテゴリ */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              カテゴリ
            </label>
            <select
              value={formData.category}
              onChange={(e) => handleInputChange('category', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {categories.map(cat => (
                <option key={cat.value} value={cat.value}>
                  {cat.label}
                </option>
              ))}
            </select>
          </div>
          
          {/* 説明 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              説明
            </label>
            <textarea
              value={formData.description}
              onChange={(e) => handleInputChange('description', e.target.value)}
              placeholder="スポットの詳細説明..."
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          
          {/* 住所 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              住所
            </label>
            <Input
              type="text"
              value={formData.address}
              onChange={(e) => handleInputChange('address', e.target.value)}
              placeholder="例: 東京都墨田区押上1-1-2"
            />
          </div>
          
          {/* 位置情報 */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                緯度
              </label>
              <Input
                type="number"
                step="any"
                value={formData.latitude || ''}
                onChange={(e) => handleInputChange('latitude', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="35.7101"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                経度
              </label>
              <Input
                type="number"
                step="any"
                value={formData.longitude || ''}
                onChange={(e) => handleInputChange('longitude', e.target.value ? parseFloat(e.target.value) : undefined)}
                placeholder="139.8107"
              />
            </div>
          </div>
          
          {/* 価格帯 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              価格帯
            </label>
            <select
              value={formData.price_range}
              onChange={(e) => handleInputChange('price_range', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">選択してください</option>
              <option value="$">$ (リーズナブル)</option>
              <option value="$$">$$ (普通)</option>
              <option value="$$$">$$$ (高め)</option>
              <option value="$$$$">$$$$ (高級)</option>
            </select>
          </div>
          
          {/* 画像URL */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              画像URL
            </label>
            <Input
              type="url"
              value={formData.image_url}
              onChange={(e) => handleInputChange('image_url', e.target.value)}
              placeholder="https://example.com/image.jpg"
            />
          </div>
          
          {/* 送信ボタン */}
          <div className="flex justify-end space-x-4">
            {onClose && (
              <Button variant="ghost" onClick={onClose} disabled={isLoading}>
                キャンセル
              </Button>
            )}
            <Button type="submit" disabled={isLoading}>
              {isLoading ? '登録中...' : 'スポットを登録'}
            </Button>
          </div>
        </form>
      </div>
      
    </Card>
  );
};

export default SpotRegistration;
