import React, { useState, useEffect } from 'react';
import { MapPin, Heart, Settings, Save, RotateCcw } from 'lucide-react';
import { toast } from 'react-hot-toast';

interface SearchPreferences {
  // 地理的設定
  preferredArea: {
    name: string;
    latitude: number;
    longitude: number;
    radius: number; // km
  };
  
  // 趣味・志向設定
  interests: {
    nature: number;      // 自然・公園 (0-10)
    culture: number;     // 文化・歴史 (0-10)
    food: number;        // グルメ・食事 (0-10)
    shopping: number;    // ショッピング (0-10)
    entertainment: number; // エンターテイメント (0-10)
    sports: number;      // スポーツ・アクティビティ (0-10)
    relaxation: number;  // リラクゼーション・温泉 (0-10)
    nightlife: number;   // ナイトライフ (0-10)
  };
  
  // 検索設定
  searchSettings: {
    maxResults: number;        // 候補数
    maxDistance: number;       // 最大距離(km)
    pricePreference: string;   // 'low' | 'medium' | 'high' | 'any'
    travelStyle: string;       // 'solo' | 'couple' | 'family' | 'group'
    duration: string;          // 'short' | 'half-day' | 'full-day' | 'multi-day'
  };
}

const defaultPreferences: SearchPreferences = {
  preferredArea: {
    name: '東京',
    latitude: 35.6762,
    longitude: 139.6503,
    radius: 50
  },
  interests: {
    nature: 5,
    culture: 5,
    food: 5,
    shopping: 5,
    entertainment: 5,
    sports: 5,
    relaxation: 5,
    nightlife: 5
  },
  searchSettings: {
    maxResults: 5,
    maxDistance: 50,
    pricePreference: 'any',
    travelStyle: 'solo',
    duration: 'half-day'
  }
};

const SearchSettingsPage: React.FC = () => {
  const [preferences, setPreferences] = useState<SearchPreferences>(defaultPreferences);
  const [isLoading, setIsLoading] = useState(false);

  // ローカルストレージから設定を読み込み
  useEffect(() => {
    const savedPreferences = localStorage.getItem('search_preferences');
    if (savedPreferences) {
      try {
        setPreferences(JSON.parse(savedPreferences));
      } catch (error) {
        console.error('設定の読み込みエラー:', error);
      }
    }
  }, []);

  // 設定を保存
  const savePreferences = () => {
    setIsLoading(true);
    try {
      localStorage.setItem('search_preferences', JSON.stringify(preferences));
      toast.success('検索設定を保存しました');
    } catch (error) {
      toast.error('設定の保存に失敗しました');
    } finally {
      setIsLoading(false);
    }
  };

  // 設定をリセット
  const resetPreferences = () => {
    setPreferences(defaultPreferences);
    toast('設定をデフォルトにリセットしました');
  };

  // 趣味・志向の更新
  const updateInterest = (key: keyof typeof preferences.interests, value: number) => {
    setPreferences(prev => ({
      ...prev,
      interests: {
        ...prev.interests,
        [key]: value
      }
    }));
  };

  // 検索設定の更新
  const updateSearchSetting = (key: keyof typeof preferences.searchSettings, value: any) => {
    setPreferences(prev => ({
      ...prev,
      searchSettings: {
        ...prev.searchSettings,
        [key]: value
      }
    }));
  };

  // エリア設定の更新
  const updateArea = (field: keyof typeof preferences.preferredArea, value: any) => {
    setPreferences(prev => ({
      ...prev,
      preferredArea: {
        ...prev.preferredArea,
        [field]: value
      }
    }));
  };

  const interestLabels = {
    nature: '🌲 自然・公園',
    culture: '🏛️ 文化・歴史',
    food: '🍜 グルメ・食事',
    shopping: '🛍️ ショッピング',
    entertainment: '🎭 エンターテイメント',
    sports: '⚽ スポーツ・アクティビティ',
    relaxation: '♨️ リラクゼーション',
    nightlife: '🌃 ナイトライフ'
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-4 flex items-center justify-center gap-3">
            <Settings size={32} className="text-blue-500" />
            AI検索設定
          </h1>
          <p className="text-gray-600">
            あなたの趣味・志向と旅行スタイルを設定して、最適なスポット検索を実現
          </p>
        </div>

        <div className="space-y-8">
          {/* 地理的設定 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <MapPin size={24} className="text-green-500" />
              旅行エリア設定
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  メインエリア
                </label>
                <input
                  type="text"
                  value={preferences.preferredArea.name}
                  onChange={(e) => updateArea('name', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="例: 東京, 大阪, 京都"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  検索半径: {preferences.preferredArea.radius}km
                </label>
                <input
                  type="range"
                  min="5"
                  max="200"
                  value={preferences.preferredArea.radius}
                  onChange={(e) => updateArea('radius', parseInt(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-gray-500 mt-1">
                  <span>5km</span>
                  <span>200km</span>
                </div>
              </div>
            </div>
          </div>

          {/* 趣味・志向設定 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6 flex items-center gap-2">
              <Heart size={24} className="text-red-500" />
              趣味・志向設定
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {Object.entries(preferences.interests).map(([key, value]) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {interestLabels[key as keyof typeof interestLabels]} 
                    <span className="ml-2 text-blue-600 font-bold">{value}/10</span>
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="10"
                    value={value}
                    onChange={(e) => updateInterest(key as keyof typeof preferences.interests, parseInt(e.target.value))}
                    className="w-full"
                  />
                  <div className="flex justify-between text-xs text-gray-500 mt-1">
                    <span>興味なし</span>
                    <span>とても興味あり</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 検索設定 */}
          <div className="bg-white rounded-xl shadow-sm p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-6">
              🔍 検索詳細設定
            </h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  候補数
                </label>
                <select
                  value={preferences.searchSettings.maxResults}
                  onChange={(e) => updateSearchSetting('maxResults', parseInt(e.target.value))}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value={3}>3件</option>
                  <option value={5}>5件（推奨）</option>
                  <option value={8}>8件</option>
                  <option value={10}>10件</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  予算レベル
                </label>
                <select
                  value={preferences.searchSettings.pricePreference}
                  onChange={(e) => updateSearchSetting('pricePreference', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="any">指定なし</option>
                  <option value="low">節約重視</option>
                  <option value="medium">標準</option>
                  <option value="high">贅沢志向</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  旅行スタイル
                </label>
                <select
                  value={preferences.searchSettings.travelStyle}
                  onChange={(e) => updateSearchSetting('travelStyle', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="solo">一人旅</option>
                  <option value="couple">カップル</option>
                  <option value="family">家族旅行</option>
                  <option value="group">グループ</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  最大距離: {preferences.searchSettings.maxDistance}km
                </label>
                <input
                  type="range"
                  min="5"
                  max="500"
                  value={preferences.searchSettings.maxDistance}
                  onChange={(e) => updateSearchSetting('maxDistance', parseInt(e.target.value))}
                  className="w-full"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  滞在時間
                </label>
                <select
                  value={preferences.searchSettings.duration}
                  onChange={(e) => updateSearchSetting('duration', e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                >
                  <option value="short">短時間（1-2時間）</option>
                  <option value="half-day">半日（3-6時間）</option>
                  <option value="full-day">1日（6-8時間）</option>
                  <option value="multi-day">複数日</option>
                </select>
              </div>
            </div>
          </div>

          {/* 設定の保存・リセット */}
          <div className="flex justify-center gap-4">
            <button
              onClick={resetPreferences}
              className="px-6 py-3 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <RotateCcw size={18} />
              リセット
            </button>
            
            <button
              onClick={savePreferences}
              disabled={isLoading}
              className="px-8 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              <Save size={18} />
              {isLoading ? '保存中...' : '設定を保存'}
            </button>
          </div>

          {/* 設定プレビュー */}
          <div className="bg-blue-50 rounded-xl p-6">
            <h3 className="font-bold text-blue-900 mb-4">🎯 現在の設定プレビュー</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <strong>検索エリア:</strong> {preferences.preferredArea.name}（半径{preferences.preferredArea.radius}km）
              </div>
              <div>
                <strong>候補数:</strong> {preferences.searchSettings.maxResults}件
              </div>
              <div>
                <strong>旅行スタイル:</strong> {preferences.searchSettings.travelStyle}
              </div>
            </div>
            <div className="mt-3">
              <strong>重視する要素:</strong>{' '}
              {Object.entries(preferences.interests)
                .filter(([_, value]) => value >= 7)
                .map(([key, _]) => interestLabels[key as keyof typeof interestLabels])
                .join(', ') || '特になし'}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SearchSettingsPage;