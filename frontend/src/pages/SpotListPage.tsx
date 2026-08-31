import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';

const SpotListPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeFilter, setActiveFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  // ダミーデータ（実際はAPIから取得）
  const dummySpots = [
    {
      id: '1',
      name: '東京タワー',
      category: 'sightseeing',
      address: '東京都港区芝公園4-2-8',
      rating: 4.2,
      estimated_duration: 90,
      estimated_cost: 1200,
      visited: false
    },
    {
      id: '2', 
      name: '浅草寺',
      category: 'sightseeing',
      address: '東京都台東区浅草2-3-1',
      rating: 4.5,
      estimated_duration: 60,
      estimated_cost: 0,
      visited: true
    }
  ];

  const categories = [
    { id: 'all', name: '全て', icon: '📍', count: dummySpots.length },
    { id: 'sightseeing', name: '観光地', icon: '🏛️', count: 2 },
    { id: 'food', name: 'グルメ', icon: '🍜', count: 0 },
    { id: 'shopping', name: 'ショッピング', icon: '🛍️', count: 0 },
    { id: 'accommodation', name: '宿泊', icon: '🏨', count: 0 },
  ];

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'sightseeing': return '🏛️';
      case 'food': return '🍜';
      case 'shopping': return '🛍️';
      case 'accommodation': return '🏨';
      case 'transport': return '🚃';
      default: return '📍';
    }
  };

  const filteredSpots = dummySpots.filter(spot => {
    const matchesFilter = activeFilter === 'all' || spot.category === activeFilter;
    const matchesSearch = spot.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                         spot.address.toLowerCase().includes(searchQuery.toLowerCase());
    return matchesFilter && matchesSearch;
  });

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="flex items-center mb-6">
          <button 
            onClick={() => navigate('/dashboard')}
            className="mr-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-3xl font-bold text-gray-900">📋 スポット一覧</h1>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
          {/* サイドバー - フィルター */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">フィルター</h2>
              
              {/* 検索ボックス */}
              <div className="mb-6">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  検索
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="スポット名、住所で検索..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              {/* カテゴリフィルター */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  カテゴリ
                </label>
                <div className="space-y-2">
                  {categories.map((category) => (
                    <button
                      key={category.id}
                      onClick={() => setActiveFilter(category.id)}
                      className={`w-full flex items-center justify-between p-2 rounded-lg transition-colors ${
                        activeFilter === category.id
                          ? 'bg-blue-50 text-blue-700 border border-blue-200'
                          : 'hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className="flex items-center">
                        <span className="mr-2">{category.icon}</span>
                        {category.name}
                      </span>
                      <span className="text-sm bg-gray-200 px-2 py-1 rounded">
                        {category.count}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* メインコンテンツ - スポット一覧 */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-center mb-6">
                <h2 className="text-lg font-semibold text-gray-900">
                  スポット一覧 ({filteredSpots.length}件)
                </h2>
                <button
                  onClick={() => navigate('/spots/register')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  ➕ 新規登録
                </button>
              </div>

              {filteredSpots.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {filteredSpots.map((spot) => (
                    <div key={spot.id} className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow">
                      <div className="flex justify-between items-start mb-2">
                        <h3 className="font-semibold text-lg text-gray-900">
                          {getCategoryIcon(spot.category)} {spot.name}
                        </h3>
                        {spot.visited && (
                          <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">
                            訪問済み
                          </span>
                        )}
                      </div>
                      
                      <p className="text-sm text-gray-600 mb-3">{spot.address}</p>
                      
                      <div className="flex items-center gap-4 text-xs text-gray-500 mb-3">
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.196-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                          <span>{spot.rating}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>{spot.estimated_duration}分</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1" />
                          </svg>
                          <span>¥{spot.estimated_cost}</span>
                        </div>
                      </div>
                      
                      <div className="flex justify-end space-x-2">
                        <button
                          onClick={() => navigate('/planner', { state: { spotId: spot.id } })}
                          className="px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                        >
                          プランに追加
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <div className="text-6xl mb-4">📍</div>
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">スポットが見つかりません</h3>
                  <p className="text-gray-600 mb-4">検索条件を変更するか、新しいスポットを登録してみてください。</p>
                  <div className="space-x-4">
                    <button
                      onClick={() => navigate('/spots/register')}
                      className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      スポット登録
                    </button>
                    <button
                      onClick={() => navigate('/search')}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      スポット検索
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SpotListPage;