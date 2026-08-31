import React from 'react';
import { Link } from 'react-router-dom';

const LandingPage = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="text-center">
          <h1 className="text-4xl md:text-6xl font-bold text-gray-900 mb-8">
            <span className="text-blue-600">🧳 TravelCanvas</span>
            <br />
            <span className="bg-gradient-to-r from-blue-600 to-cyan-600 bg-clip-text text-transparent">
              AI旅行プランナー
            </span>
          </h1>
          
          <p className="text-xl text-gray-600 mb-12 max-w-3xl mx-auto leading-relaxed">
            AIの力で理想の旅行プランを作成。あなたの希望に合わせて、
            最適なルート、宿泊施設、アクティビティを提案します。
          </p>
          
          <div className="space-y-4 sm:space-y-0 sm:space-x-6 sm:flex sm:justify-center">
            <Link
              to="/register"
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-medium rounded-xl text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 shadow-lg transform transition-all duration-200 hover:scale-105"
            >
              今すぐ始める
            </Link>
            
            <Link
              to="/login"
              className="w-full sm:w-auto inline-flex items-center justify-center px-8 py-4 text-base font-medium rounded-xl text-gray-700 bg-white hover:bg-gray-50 border border-gray-300 shadow-md transition-all duration-200 hover:shadow-lg"
            >
              ログイン
            </Link>
          </div>
        </div>
        
        <div className="mt-20 grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="text-center p-8 bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div className="text-5xl mb-6">🤖</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-4">AI最適化</h3>
            <p className="text-gray-600 leading-relaxed">
              AIがあなたの好みを学習し、最適な旅行プランを自動生成します
            </p>
          </div>
          
          <div className="text-center p-8 bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div className="text-5xl mb-6">🗺️</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-4">スマートルート</h3>
            <p className="text-gray-600 leading-relaxed">
              効率的な移動ルートと時間配分で、旅行を最大限に楽しめます
            </p>
          </div>
          
          <div className="text-center p-8 bg-white rounded-2xl shadow-lg hover:shadow-xl transition-shadow duration-300">
            <div className="text-5xl mb-6">📱</div>
            <h3 className="text-xl font-semibold text-gray-900 mb-4">簡単操作</h3>
            <p className="text-gray-600 leading-relaxed">
              直感的なインターフェースで、誰でも簡単に旅行プランを作成できます
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;
