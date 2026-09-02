/**
 * SpotRegisterPage - スポット登録ページ
 *
 * [Gate #12] 旧実装はフォームの送信ハンドラが「TODO: スポット登録API呼び出し」の
 * ままで、実際には何も保存せずconsole.logとalert('スポット登録機能は開発中です')
 * を出すだけのスタブだった。一方でcomponents/SpotRegistration.tsx は既にGate #7jで
 * 修正済みの完全に動作するコンポーネント(spotApiService.createSpotを正しく呼び、
 * Gate #10の認証トークン同期修正の恩恵も受けている)だったが、どこからも
 * 参照されておらず(全文検索で消費者ゼロを確認済み)、一度も画面に表示されていなかった。
 * 車輪の再発明を避け、既存の動くコンポーネントをこのページで実際にレンダリングする。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import SpotRegistration from '@/components/SpotRegistration';

const SpotRegisterPage: React.FC = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center mb-6">
          <button
            onClick={() => navigate('/dashboard')}
            className="mr-4 p-2 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-3xl font-bold text-gray-900">➕ スポット登録</h1>
        </div>

        <SpotRegistration
          onSpotCreated={() => navigate('/spots')}
          onClose={() => navigate('/dashboard')}
        />
      </div>
    </div>
  );
};

export default SpotRegisterPage;
