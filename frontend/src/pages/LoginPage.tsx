import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/store/authStore';
import toast from 'react-hot-toast';

/**
 * [Gate S11] 多要素認証の2段目(パスワードが正しく、認証アプリの確認コードを待っている時)。
 * 確認コード(6桁)の代わりに回復コード(xxxxx-xxxxx)も入力できる。
 */
const MfaLoginStep: React.FC<{ onDone: () => void }> = ({ onDone }) => {
  const { verifyMfa, cancelMfa, isLoading, error } = useAuthStore();
  const [code, setCode] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    try {
      await verifyMfa(code.trim());
      onDone();
    } catch {
      setCode('');
    }
  };

  return (
    <form onSubmit={submit} className="space-y-6" aria-labelledby="mfa-login-heading">
      <div>
        <h3 id="mfa-login-heading" className="text-lg font-semibold text-ink-900 mb-2">確認コードの入力</h3>
        <p className="text-sm text-ink-700">
          認証アプリに表示されている6桁の確認コードを入力してください。端末が手元に無い時は、回復コードも使えます。
        </p>
      </div>
      <div>
        <label htmlFor="mfa-code" className="block text-sm font-medium text-ink-700 mb-2">確認コード</label>
        <input
          id="mfa-code"
          name="mfa-code"
          type="text"
          inputMode="text"
          autoComplete="one-time-code"
          autoFocus
          maxLength={32}
          required
          className="w-full px-4 py-3 border border-gray-300 rounded-xl tracking-widest focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          disabled={isLoading}
        />
      </div>
      {error && (
        <div role="alert" className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl">{error}</div>
      )}
      <button
        type="submit"
        disabled={isLoading || !code.trim()}
        className="w-full flex justify-center py-3 px-4 rounded-xl shadow-lg text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
      >
        確認してログイン
      </button>
      <button
        type="button"
        onClick={cancelMfa}
        className="w-full text-sm text-blue-700 underline"
      >
        別のアカウントでログインする
      </button>
    </form>
  );
};

const LoginPage = () => {
  const navigate = useNavigate();
  const { login, isLoading, error, clearError, pendingMfa } = useAuthStore();
  
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    
    // エラーをクリア
    if (error) {
      clearError();
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();

    // フォームバリデーション
    if (!formData.email.trim()) {
      toast.error('メールアドレスを入力してください');
      return;
    }

    if (!formData.password.trim()) {
      toast.error('パスワードを入力してください');
      return;
    }

    try {
      const result = await login(formData.email.trim(), formData.password);
      if (result === 'mfa') {
        // [Gate S11] 確認コードの入力へ(パスワードは画面から消す)
        setFormData((prev) => ({ ...prev, password: '' }));
        return;
      }

      toast.success('ログインしました！');
      console.log('✅ LoginPage: ログイン成功、ダッシュボードへリダイレクト');
      navigate('/dashboard');
    } catch (error) {
      console.error('❌ LoginPage: ログインエラー:', error);
      const errorMessage = error instanceof Error ? error.message : 'ログインに失敗しました';
      toast.error(errorMessage);
    }
  };

  return (
    <div className="min-h-screen bg-linear-to-br from-blue-50 via-white to-cyan-50 flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-surface shadow-2xl rounded-2xl overflow-hidden">
          <div className="px-8 py-10">
            <div className="text-center mb-8">
              <h2 className="text-3xl font-bold text-ink-900 mb-2">
                TravelCanvas
              </h2>
              <p className="text-ink-700">Sign in to your account</p>
            </div>
            
            {pendingMfa ? (
              <MfaLoginStep onDone={() => { toast.success('ログインしました！'); navigate('/dashboard'); }} />
            ) : (
            <form onSubmit={handleSubmit} className="space-y-6">
              <div>
                <label htmlFor="email" className="block text-sm font-medium text-ink-700 mb-2">
                  Email
                </label>
                <input
                  id="email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="Enter your email"
                  value={formData.email}
                  onChange={handleChange}
                  disabled={isLoading}
                />
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-medium text-ink-700 mb-2">
                  Password
                </label>
                <input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  className="w-full px-4 py-3 border border-gray-300 rounded-xl focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-colors"
                  placeholder="Enter your password"
                  value={formData.password}
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
                  className="w-full flex justify-center py-3 px-4 border border-transparent rounded-xl shadow-lg text-sm font-medium text-white bg-linear-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 focus:outline-hidden focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  {isLoading ? (
                    <span className="flex items-center">
                      <div className="loading mr-2"></div>
                      Signing in...
                    </span>
                  ) : (
                    'Sign in'
                  )}
                </button>
              </div>

              <div className="text-center">
                <span className="text-sm text-ink-700">
                  Don't have an account?{' '}
                  <Link 
                    to="/register" 
                    className="font-medium text-blue-600 hover:text-blue-500 transition-colors"
                  >
                    Sign up
                  </Link>
                </span>
              </div>
            </form>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoginPage;
