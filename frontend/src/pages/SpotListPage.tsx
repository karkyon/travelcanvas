/**
 * SpotListPage - スポット一覧ページ
 *
 * [Gate #15] 旧実装はハードコードされたダミーデータ2件を表示するだけの
 * スタブだった(SpotRegisterPage.tsxがGate #12まで同じ状態だったのと同型)。
 * 一方 components/SpotList.tsx は既に spotApiService を正しく呼ぶ完成された
 * コンポーネントだったが消費者ゼロで一度も画面に表示されていなかった。
 * 車輪の再発明を避け、既存の動くコンポーネントをこのページから実際に
 * レンダリングする。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import SpotList from '@/components/SpotList';

const SpotListPage: React.FC = () => {
  const navigate = useNavigate();

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

        <SpotList
          onSpotSelect={(spot) => navigate('/planner', { state: { spotId: spot.id } })}
        />
      </div>
    </div>
  );
};

export default SpotListPage;
