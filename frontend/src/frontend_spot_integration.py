#!/usr/bin/env python3
"""
TravelCanvas フロントエンドスポット機能統合
既存コンポーネントを活用したMVP実装
"""
import os
import shutil
from datetime import datetime

class FrontendSpotIntegration:
    def __init__(self):
        self.base_dir = os.getcwd()
        self.components_dir = "components"
        self.pages_dir = "pages"
        self.log_file = "frontend_integration.log"
    
    def log(self, message):
        """ログ記録"""
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        log_entry = f"[{timestamp}] {message}"
        print(f"📝 {log_entry}")
        
        with open(self.log_file, 'a', encoding='utf-8') as f:
            f.write(log_entry + "\n")
    
    def analyze_existing_components(self):
        """既存コンポーネントの分析"""
        self.log("既存コンポーネント分析開始")
        
        existing_components = {}
        
        # 重要なコンポーネントをチェック
        important_components = [
            "SpotSearch.tsx",
            "ImageSearch.tsx", 
            "DashboardPage.tsx",
            "PlannerPage.tsx"
        ]
        
        for component in important_components:
            component_path = None
            # componentsとpagesディレクトリの両方をチェック
            for directory in [self.components_dir, self.pages_dir]:
                full_path = f"{directory}/{component}"
                if os.path.exists(full_path):
                    component_path = full_path
                    break
            
            if component_path:
                with open(component_path, 'r', encoding='utf-8') as f:
                    content = f.read()
                    existing_components[component] = {
                        "path": component_path,
                        "lines": len(content.split('\n')),
                        "has_api_calls": "fetch(" in content or "axios" in content,
                        "uses_state": "useState" in content,
                        "has_forms": "form" in content.lower()
                    }
                    
        self.log(f"分析完了: {len(existing_components)}個のコンポーネント")
        return existing_components
    
    def create_spot_api_service(self):
        """スポット用APIサービス作成"""
        self.log("スポットAPIサービス作成中")
        
        # servicesディレクトリ作成
        services_dir = "services"
        os.makedirs(services_dir, exist_ok=True)
        
        api_service_content = '''/**
 * TravelCanvas スポットAPI サービス
 * バックエンドAPIとの通信を担当
 */

interface SpotData {
  id?: number;
  name: string;
  description?: string;
  category: string;
  address?: string;
  latitude?: number;
  longitude?: number;
  price_range?: string;
  image_url?: string;
  is_public?: boolean;
}

interface SpotResponse extends SpotData {
  id: number;
  created_by: number;
  visit_count: number;
  created_at: string;
  updated_at?: string;
}

class SpotApiService {
  private baseUrl: string;
  
  constructor() {
    this.baseUrl = import.meta.env.VITE_API_BASE_URL || 'http://192.168.1.248:8000/api/v1';
  }
  
  private async getHeaders(): Promise<HeadersInit> {
    const token = localStorage.getItem('access_token');
    return {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };
  }
  
  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.detail || `HTTP error! status: ${response.status}`);
    }
    return response.json();
  }
  
  /**
   * 新しいスポットを作成
   */
  async createSpot(spotData: Omit<SpotData, 'id'>): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/`, {
      method: 'POST',
      headers: await this.getHeaders(),
      body: JSON.stringify(spotData)
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポット一覧を取得
   */
  async getSpots(category?: string, limit = 20): Promise<SpotResponse[]> {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (limit) params.append('limit', limit.toString());
    
    const response = await fetch(`${this.baseUrl}/spots/?${params}`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<SpotResponse[]>(response);
  }
  
  /**
   * 特定のスポットを取得
   */
  async getSpot(spotId: number): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポットを更新
   */
  async updateSpot(spotId: number, spotData: Partial<SpotData>): Promise<SpotResponse> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'PUT',
      headers: await this.getHeaders(),
      body: JSON.stringify(spotData)
    });
    
    return this.handleResponse<SpotResponse>(response);
  }
  
  /**
   * スポットを削除
   */
  async deleteSpot(spotId: number): Promise<{ message: string }> {
    const response = await fetch(`${this.baseUrl}/spots/${spotId}`, {
      method: 'DELETE',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ message: string }>(response);
  }
  
  /**
   * カテゴリ一覧を取得
   */
  async getCategories(): Promise<{ categories: Array<{ value: string; label: string }> }> {
    const response = await fetch(`${this.baseUrl}/spots/categories/list`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ categories: Array<{ value: string; label: string }> }>(response);
  }
  
  /**
   * API接続テスト
   */
  async testConnection(): Promise<{ message: string; version: string; timestamp: string }> {
    const response = await fetch(`${this.baseUrl}/spots/test/ping`, {
      method: 'GET',
      headers: await this.getHeaders()
    });
    
    return this.handleResponse<{ message: string; version: string; timestamp: string }>(response);
  }
}

// シングルトンインスタンス
export const spotApiService = new SpotApiService();
export type { SpotData, SpotResponse };
'''
        
        with open(f"{services_dir}/spotApi.ts", 'w', encoding='utf-8') as f:
            f.write(api_service_content)
        
        self.log("スポットAPIサービス作成完了")
        return True
    
    def create_spot_registration_component(self):
        """スポット登録コンポーネント作成"""
        self.log("スポット登録コンポーネント作成中")
        
        component_content = '''/**
 * スポット登録コンポーネント
 * キーワード、地図、画像からスポットを登録
 */
import React, { useState, useEffect } from 'react';
import { spotApiService, SpotData } from '../services/spotApi';
import { Button } from './Button';
import { Input } from './Input';
import { Card } from './Card';
import { Toast } from './Toast';

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
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
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
  
  const handleInputChange = (field: keyof SpotData, value: string | number) => {
    setFormData(prev => ({
      ...prev,
      [field]: value
    }));
  };
  
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      setToast({ message: 'スポット名は必須です', type: 'error' });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const newSpot = await spotApiService.createSpot(formData);
      setToast({ message: 'スポットを登録しました！', type: 'success' });
      
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
      setToast({ 
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
      
      {/* トースト通知 */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </Card>
  );
};

export default SpotRegistration;
'''
        
        with open(f"{self.components_dir}/SpotRegistration.tsx", 'w', encoding='utf-8') as f:
            f.write(component_content)
        
        self.log("スポット登録コンポーネント作成完了")
        return True
    
    def create_spot_list_component(self):
        """スポット一覧コンポーネント作成"""
        self.log("スポット一覧コンポーネント作成中")
        
        component_content = '''/**
 * スポット一覧コンポーネント
 * 登録済みスポットの表示と管理
 */
import React, { useState, useEffect } from 'react';
import { spotApiService, SpotResponse } from '../services/spotApi';
import { Button } from './Button';
import { Card } from './Card';
import { Toast } from './Toast';

interface SpotListProps {
  onSpotSelect?: (spot: SpotResponse) => void;
  refreshTrigger?: number;
}

const SpotList: React.FC<SpotListProps> = ({ onSpotSelect, refreshTrigger }) => {
  const [spots, setSpots] = useState<SpotResponse[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [categories, setCategories] = useState<Array<{ value: string; label: string }>>([]);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  
  const loadSpots = async () => {
    setIsLoading(true);
    try {
      const spotsData = await spotApiService.getSpots(selectedCategory);
      setSpots(spotsData);
    } catch (error) {
      console.error('スポット読み込みエラー:', error);
      setToast({ 
        message: 'スポットの読み込みに失敗しました', 
        type: 'error' 
      });
    } finally {
      setIsLoading(false);
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
  }, []);
  
  useEffect(() => {
    loadSpots();
  }, [selectedCategory, refreshTrigger]);
  
  const handleDeleteSpot = async (spotId: number) => {
    if (!confirm('このスポットを削除しますか？')) {
      return;
    }
    
    try {
      await spotApiService.deleteSpot(spotId);
      setToast({ message: 'スポットを削除しました', type: 'success' });
      loadSpots(); // リロード
    } catch (error) {
      console.error('スポット削除エラー:', error);
      setToast({ 
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
      
      {/* トースト通知 */}
      {toast && (
        <Toast
          message={toast.message}
          type={toast.type}
          onClose={() => setToast(null)}
        />
      )}
    </div>
  );
};

export default SpotList;
'''
        
        with open(f"{self.components_dir}/SpotList.tsx", 'w', encoding='utf-8') as f:
            f.write(component_content)
        
        self.log("スポット一覧コンポーネント作成完了")
        return True
    
    def update_dashboard_page(self):
        """ダッシュボードページにスポット機能を統合"""
        self.log("ダッシュボードページ更新中")
        
        dashboard_file = f"{self.pages_dir}/DashboardPage.tsx"
        
        if not os.path.exists(dashboard_file):
            self.log("DashboardPage.tsx が見つかりません", "ERROR")
            return False
        
        # バックアップ
        backup_file = f"{dashboard_file}.backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        shutil.copy2(dashboard_file, backup_file)
        self.log(f"DashboardPage.tsx を {backup_file} にバックアップ")
        
        # 既存内容を読み込み
        with open(dashboard_file, 'r', encoding='utf-8') as f:
            content = f.read()
        
        # スポット機能の統合コードを追加
        spot_integration = '''
// スポット機能のインポート追加
import SpotRegistration from '../components/SpotRegistration';
import SpotList from '../components/SpotList';

// スポット機能用のstate（既存のuseStateの後に追加）
const [activeSpotTab, setActiveSpotTab] = useState<'list' | 'register'>('list');
const [spotRefreshTrigger, setSpotRefreshTrigger] = useState(0);

// スポット作成成功時のハンドラー
const handleSpotCreated = (spot: any) => {
  setSpotRefreshTrigger(prev => prev + 1);
  setActiveSpotTab('list');
};

// スポット機能のJSX（既存のJSX内の適切な場所に追加）
const renderSpotSection = () => (
  <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
    <div className="flex justify-between items-center mb-6">
      <h2 className="text-xl font-semibold text-gray-900">スポット管理</h2>
      <div className="flex space-x-2">
        <button
          onClick={() => setActiveSpotTab('list')}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            activeSpotTab === 'list'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          スポット一覧
        </button>
        <button
          onClick={() => setActiveSpotTab('register')}
          className={`px-4 py-2 rounded-md text-sm font-medium ${
            activeSpotTab === 'register'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
          }`}
        >
          新規登録
        </button>
      </div>
    </div>
    
    {activeSpotTab === 'list' ? (
      <SpotList 
        refreshTrigger={spotRefreshTrigger}
        onSpotSelect={(spot) => console.log('Selected spot:', spot)}
      />
    ) : (
      <SpotRegistration 
        onSpotCreated={handleSpotCreated}
      />
    )}
  </div>
);
'''
        
        # 簡単な統合版ダッシュボードを作成
        updated_dashboard = '''import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import SpotRegistration from '../components/SpotRegistration';
import SpotList from '../components/SpotList';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<'overview' | 'spots'>('overview');
  const [activeSpotTab, setActiveSpotTab] = useState<'list' | 'register'>('list');
  const [spotRefreshTrigger, setSpotRefreshTrigger] = useState(0);
  
  // ユーザー情報取得
  const [user, setUser] = useState<any>(null);
  
  useEffect(() => {
    // 認証チェック
    const token = localStorage.getItem('access_token');
    if (!token) {
      navigate('/login');
      return;
    }
    
    // ユーザー情報をlocalStorageから取得（簡易実装）
    const userStr = localStorage.getItem('user');
    if (userStr) {
      setUser(JSON.parse(userStr));
    }
  }, [navigate]);
  
  const handleSpotCreated = (spot: any) => {
    setSpotRefreshTrigger(prev => prev + 1);
    setActiveSpotTab('list');
  };
  
  const handleLogout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('user');
    navigate('/');
  };
  
  if (!user) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
      </div>
    );
  }
  
  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <header className="bg-white shadow-sm border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <h1 className="text-2xl font-bold text-gray-900">TravelCanvas</h1>
            <div className="flex items-center space-x-4">
              <span className="text-gray-700">Welcome back, {user.username}!</span>
              <button
                onClick={handleLogout}
                className="bg-red-600 text-white px-4 py-2 rounded-md text-sm hover:bg-red-700"
              >
                ログアウト
              </button>
            </div>
          </div>
        </div>
      </header>
      
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* タブナビゲーション */}
        <div className="mb-8">
          <nav className="flex space-x-8">
            <button
              onClick={() => setActiveTab('overview')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'overview'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              概要
            </button>
            <button
              onClick={() => setActiveTab('spots')}
              className={`py-2 px-1 border-b-2 font-medium text-sm ${
                activeTab === 'spots'
                  ? 'border-blue-500 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
              }`}
            >
              スポット管理
            </button>
          </nav>
        </div>
        
        {/* コンテンツ */}
        {activeTab === 'overview' ? (
          <div className="space-y-6">
            {/* 概要セクション */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-blue-100 rounded-lg">
                    <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">Create New Plan</h3>
                    <p className="text-sm text-gray-500">Start planning your next travel adventure</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-green-100 rounded-lg">
                    <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">My Plans</h3>
                    <p className="text-sm text-gray-500">View and manage your travel plans</p>
                  </div>
                </div>
              </div>
              
              <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
                <div className="flex items-center">
                  <div className="p-2 bg-purple-100 rounded-lg">
                    <svg className="h-6 w-6 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                  </div>
                  <div className="ml-4">
                    <h3 className="text-lg font-medium text-gray-900">AI Optimize</h3>
                    <p className="text-sm text-gray-500">Optimize routes with AI assistance</p>
                  </div>
                </div>
              </div>
            </div>
            
            {/* Recent Activity */}
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <h2 className="text-lg font-medium text-gray-900 mb-4">Recent Activity</h2>
              <div className="space-y-3">
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <p className="ml-3 text-sm text-gray-600">Welcome to TravelCanvas!</p>
                </div>
                <div className="flex items-center">
                  <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                  <p className="ml-3 text-sm text-gray-600">Get started by creating your first travel plan</p>
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-xl font-semibold text-gray-900">スポット管理</h2>
              <div className="flex space-x-2">
                <button
                  onClick={() => setActiveSpotTab('list')}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    activeSpotTab === 'list'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  スポット一覧
                </button>
                <button
                  onClick={() => setActiveSpotTab('register')}
                  className={`px-4 py-2 rounded-md text-sm font-medium ${
                    activeSpotTab === 'register'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                >
                  新規登録
                </button>
              </div>
            </div>
            
            {activeSpotTab === 'list' ? (
              <SpotList 
                refreshTrigger={spotRefreshTrigger}
                onSpotSelect={(spot) => console.log('Selected spot:', spot)}
              />
            ) : (
              <SpotRegistration 
                onSpotCreated={handleSpotCreated}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default DashboardPage;
'''
        
        with open(dashboard_file, 'w', encoding='utf-8') as f:
            f.write(updated_dashboard)
        
        self.log("ダッシュボードページ更新完了")
        return True
    
    def run_integration(self):
        """統合実行"""
        self.log("=== フロントエンドスポット機能統合開始 ===")
        
        # 1. 既存コンポーネント分析
        existing = self.analyze_existing_components()
        
        # 2. APIサービス作成
        if not self.create_spot_api_service():
            self.log("APIサービス作成失敗", "ERROR")
            return False
        
        # 3. スポット登録コンポーネント作成
        if not self.create_spot_registration_component():
            self.log("スポット登録コンポーネント作成失敗", "ERROR")
            return False
        
        # 4. スポット一覧コンポーネント作成
        if not self.create_spot_list_component():
            self.log("スポット一覧コンポーネント作成失敗", "ERROR")
            return False
        
        # 5. ダッシュボード更新
        if not self.update_dashboard_page():
            self.log("ダッシュボード更新失敗", "ERROR")
            return False
        
        self.log("=== フロントエンドスポット機能統合完了 ===")
        return True

def main():
    """メイン実行"""
    integration = FrontendSpotIntegration()
    
    print("🚀 TravelCanvas フロントエンドスポット機能統合")
    print("=" * 60)
    
    success = integration.run_integration()
    
    if success:
        print("\n🎉 フロントエンド統合完了！")
        print("\n📋 作成されたファイル:")
        print("  ✅ services/spotApi.ts - スポットAPI通信サービス")
        print("  ✅ components/SpotRegistration.tsx - スポット登録フォーム")
        print("  ✅ components/SpotList.tsx - スポット一覧表示")
        print("  ✅ pages/DashboardPage.tsx - ダッシュボード更新")
        
        print("\n🚀 次の実行コマンド:")
        print("  1. cd ~/travelcanvas/frontend")
        print("  2. npm run dev または tc-frontend")
        print("  3. http://192.168.1.248:3000 でアクセス")
        
        print("\n📊 期待される機能:")
        print("  - ダッシュボードにスポット管理タブ追加")
        print("  - スポット新規登録フォーム")
        print("  - 登録済みスポット一覧表示")
        print("  - カテゴリ別フィルタリング")
        print("  - スポット削除機能")
        
        return True
    else:
        print("\n❌ 統合に失敗しました")
        print("ログファイル frontend_integration.log を確認してください")
        return False

if __name__ == "__main__":
    import sys
    if not main():
        sys.exit(1)
