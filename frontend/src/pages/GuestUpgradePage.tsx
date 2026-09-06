import React, { useState } from 'react';
import { useNavigate, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

/**
 * [Gate #35] ゲストが作成中の旅行プランを失わずに正規アカウントへ昇格するための画面。
 * RegisterPage.tsxと見た目・バリデーションは揃えつつ、authStore.upgradeGuest()
 * (POST /auth/guest/upgrade)を呼ぶ点のみが異なる。ゲストでないユーザーがこの
 * 画面へ来た場合はダッシュボードへリダイレクトする。
 */
const GuestUpgradePage = () => {
  const navigate = useNavigate();
  const { upgradeGuest, isGuest, isLoading, error, clearError } = useAuthStore();

  const [formData, setFormData] = useState({
    username: '',
    email: '',
    password: '',
    confirmPassword: '',
  });

  if (!isGuest) {
    return <Navigate to="/dashboard" replace />;
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (error) {
      clearError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    if (!formData.username.trim()) {
      toast.error('ユーザー名を入力してください');
      return;
    }
    if (!formData.email.trim()) {
      toast.error('メールアドレスを入力してください');
      return;
    }
    if (!formData.password.trim()) {
      toast.error('パスワードを入力してください');
      return;
    }
    if (formData.password !== formData.confirmPassword) {
      toast.error('パスワードが一致しません');
      return;
    }
    if (formData.password.length < 6) {
      toast.error('パスワードは6文字以上で入力してください');
      return;
    }

    try {
      await upgradeGuest(formData.username.trim(), formData.email.trim(), formData.password);
      toast.success('アカウントを作成しました。これまでのプランはそのまま引き継がれています。');
      navigate('/dashboard');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'アカウント登録に失敗しました';
      toast.error(message);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white shadow-2xl rounded-2xl overflow-hidden">
          <div className="px-8 py-10">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-bold text-gray-900 mb-2">
                アカウントを作成して保存
              </h2>
              <p className="text-gray-600 text-sm">
                ここまで作成したプランはそのまま引き継がれます。ブラウザを変えても続きから使えるようになります。
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-2">
                  ユーザー名
                </label>
                <input
                  id="username"
                  name="username"
                  type="text"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={formData.username}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                  メールアドレス
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-2">
                  パスワード
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={formData.password}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-2">
                  パスワード(確認)
                </label>
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              {error && (
                <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-xl">
                  {error}
                </div>
              )}

              <div>
                <button
                  type="submit"
                  disabled={isLoading}
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-sm font-medium text-white bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isLoading ? '登録しています...' : 'アカウントを作成'}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

export default GuestUpgradePage;
