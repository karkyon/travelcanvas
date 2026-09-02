/**
 * ダッシュボードページ
 * ユーザーのメイン画面
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { spotApiService } from '../services/spotApi';
import { usePlanStore } from '../store/planStore';

const DashboardPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuthStore();
  const [loading, setLoading] = useState(true);
  // [Gate #14] 以前は登録スポット/お気に入り/訪問済みが常にハードコードの0だった。
  // [Gate #15] お気に入りAPI(backend/app/api/v1/spots.py)を新規実装したのに合わせ、
  // 登録スポット数・お気に入り数の両方を実データに置き換える。
  // [Gate #19] 訪問記録API(UserSpotVisit新規テーブル)を実装したのに合わせ、
  // 訪問済み数も実データに置き換える。
  const [spotCount, setSpotCount] = useState(0);
  const [favoriteCount, setFavoriteCount] = useState(0);
  const [visitedCount, setVisitedCount] = useState(0);
  const [statsLoading, setStatsLoading] = useState(true);
  // [Gate #16] 「最近の活動」は常に固定の「まだ活動がありません」表示だった。
  // バックエンドに専用の活動ログテーブルは存在しないため、既存のスポット/プラン
  // 作成日時(created_at)から擬似的な活動フィードを構成する。
  interface ActivityItem {
    id: string;
    type: 'spot' | 'plan';
    label: string;
    createdAt: string;
  }
  const [activities, setActivities] = useState<ActivityItem[]>([]);

  // 認証チェック（一度だけ実行）
  useEffect(() => {
    console.log('🔍 DashboardPage: 認証状態確認', { isAuthenticated, user });
    
    if (!isAuthenticated) {
      console.log('🚫 未認証のため、ログインページへリダイレクト');
      navigate('/login');
      return;
    }
    
    setLoading(false);
  }, []); // 空の依存配列で一度だけ実行

  // 登録スポット数・お気に入り数を取得
  useEffect(() => {
    if (!isAuthenticated || !user) return;
    (async () => {
      try {
        const [spots, favorites, visits] = await Promise.all([
          spotApiService.getSpots(undefined, 100),
          spotApiService.getFavorites(),
          spotApiService.getVisits(),
        ]);
        setSpotCount(spots.filter((s) => s.created_by === user.id).length);
        setFavoriteCount(favorites.length);
        setVisitedCount(visits.length);

        await usePlanStore.getState().loadPlans();
        const plans = usePlanStore.getState().plans;

        const spotActivities: ActivityItem[] = spots
          .filter((s) => s.created_by === user.id)
          .map((s) => ({
            id: `spot-${s.id}`,
            type: 'spot',
            label: `「${s.name}」を登録しました`,
            createdAt: s.created_at,
          }));
        const planActivities: ActivityItem[] = plans
          .filter((p) => p.created_at)
          .map((p) => ({
            id: `plan-${p.id}`,
            type: 'plan',
            label: `「${p.title}」プランを作成しました`,
            createdAt: p.created_at as string,
          }));

        const merged = [...spotActivities, ...planActivities]
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 5);
        setActivities(merged);
      } catch (error) {
        console.error('統計取得エラー:', error);
      } finally {
        setStatsLoading(false);
      }
    })();
  }, [isAuthenticated, user]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-screen">
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-6xl mx-auto">
        {/* ヘッダー */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">
            🌍 TravelCanvas ダッシュボード
          </h1>
          <p className="text-gray-600">
            ようこそ、{user?.username || 'ユーザー'}さん！
          </p>
        </div>

        {/* 統計カード */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-2 rounded-lg bg-blue-100">
                <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900">登録スポット</h3>
                <p className="text-2xl font-bold text-blue-600">{statsLoading ? '…' : spotCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-2 rounded-lg bg-green-100">
                <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900">お気に入り</h3>
                <p className="text-2xl font-bold text-green-600">{statsLoading ? '…' : favoriteCount}</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <div className="flex items-center">
              <div className="p-2 rounded-lg bg-purple-100">
                <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="ml-4">
                <h3 className="text-lg font-semibold text-gray-900">訪問済み</h3>
                <p className="text-2xl font-bold text-purple-600">{statsLoading ? '…' : visitedCount}</p>
              </div>
            </div>
          </div>
        </div>

        {/* クイックアクション */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">クイックアクション</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <button 
              onClick={() => navigate('/spots/search')}
              className="flex flex-col items-center p-4 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
            >
              <svg className="w-8 h-8 text-blue-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">スポット検索</span>
            </button>

            <button 
              onClick={() => navigate('/spots/register')}
              className="flex flex-col items-center p-4 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
            >
              <svg className="w-8 h-8 text-green-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span className="text-sm font-medium text-gray-700">スポット登録</span>
            </button>

            <button 
              onClick={() => navigate('/spots')}
              className="flex flex-col items-center p-4 bg-purple-50 rounded-lg hover:bg-purple-100 transition-colors"
            >
              <svg className="w-8 h-8 text-purple-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
              </svg>
              <span className="text-sm font-medium text-gray-700">スポット一覧</span>
            </button>

            <button 
              onClick={() => navigate('/profile')}
              className="flex flex-col items-center p-4 bg-orange-50 rounded-lg hover:bg-orange-100 transition-colors"
            >
              <svg className="w-8 h-8 text-orange-600 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
              <span className="text-sm font-medium text-gray-700">プロフィール</span>
            </button>
          </div>
        </div>

        {/* 最近の活動 */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-4">最近の活動</h2>
          {activities.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {activities.map((activity) => (
                <li key={activity.id} className="flex items-center gap-3 py-3">
                  <span className="text-xl">{activity.type === 'spot' ? '📍' : '🗺️'}</span>
                  <div className="flex-1">
                    <p className="text-sm text-gray-800">{activity.label}</p>
                    <p className="text-xs text-gray-400">
                      {new Date(activity.createdAt).toLocaleString('ja-JP')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-center py-8 text-gray-500">
              <svg className="w-12 h-12 mx-auto mb-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <p>まだ活動がありません</p>
              <p className="text-sm">スポットを検索・登録して始めましょう！</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default DashboardPage;
