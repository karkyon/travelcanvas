import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { 
  User, Bell, Shield, Settings, LogOut, Save, 
  CheckCircle, AlertCircle, Eye, EyeOff
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api as apiService } from '@/services/api';

interface SettingsTab {
  id: string;
  name: string;
  icon: React.ReactNode;
  component: React.ComponentType<any>;
}

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();
  const [activeTab, setActiveTab] = useState('profile');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const [profileData, setProfileData] = useState({
    full_name: user?.username || '',
    email: user?.email || '',
    username: user?.username || '',
    bio: ''
  });
  
  const [notificationSettings, setNotificationSettings] = useState({
    email_notifications: true,
    push_notifications: true,
    plan_updates: true,
    collaboration_invites: true,
    optimization_complete: true,
    system_maintenance: false,
    marketing_emails: false
  });
  
  const [preferences, setPreferences] = useState({
    language: 'ja',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
    theme: 'light',
    travel_style: 'balanced'
  });

  // [Gate #20] 以前は保存ボタンがsetTimeoutで成功を偽装するだけで、
  // 実際にはどこにも保存されず、画面初期値も常に固定のデフォルト値だった。
  // GET /auth/me(今回新規実装)から実際に保存済みのpreferencesを読み込む。
  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getCurrentUser();
        const saved = response.data?.preferences as Record<string, any> | undefined;
        if (saved) {
          if (saved.full_name || saved.bio) {
            setProfileData((prev) => ({
              ...prev,
              full_name: saved.full_name ?? prev.full_name,
              bio: saved.bio ?? prev.bio,
            }));
          }
          if (saved.notification_settings) {
            setNotificationSettings((prev) => ({ ...prev, ...saved.notification_settings }));
          }
          const { full_name, bio, notification_settings, ...rest } = saved;
          if (Object.keys(rest).length > 0) {
            setPreferences((prev) => ({ ...prev, ...rest }));
          }
        }
      } catch (error) {
        console.error('設定読み込みエラー:', error);
      }
    })();
  }, []);

  const [passwordData, setPasswordData] = useState({
    current_password: '',
    new_password: '',
    confirm_password: ''
  });

  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  });

  const showMessage = (text: string, type: 'success' | 'error') => {
    setMessage({ text, type });
    setTimeout(() => setMessage(null), 5000);
  };

  // Profile Tab Component
  const ProfileTab: React.FC = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">プロフィール情報</h3>
        
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
              <User size={32} className="text-gray-400" />
            </div>
          </div>
          <div>
            <p className="text-sm text-gray-600">プロフィール画像</p>
            <p className="text-xs text-gray-500">JPG、PNG、最大2MB</p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              フルネーム
            </label>
            <input
              type="text"
              value={profileData.full_name}
              onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              ユーザー名
            </label>
            <input
              type="text"
              value={profileData.username}
              onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              メールアドレス
            </label>
            <input
              type="email"
              value={profileData.email}
              onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div className="md:col-span-2">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              自己紹介
            </label>
            <textarea
              value={profileData.bio}
              onChange={(e) => setProfileData({ ...profileData, bio: e.target.value })}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              placeholder="自己紹介を入力してください..."
            />
          </div>
        </div>
      </div>
    </div>
  );

  // Notifications Tab Component
  const NotificationsTab: React.FC = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">通知設定</h3>
        
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">メール通知</h4>
            <div className="space-y-3">
              {Object.entries({
                email_notifications: 'メール通知を有効にする',
                plan_updates: 'プラン更新通知',
                collaboration_invites: 'コラボレーション招待',
                optimization_complete: '最適化完了通知',
                system_maintenance: 'システムメンテナンス通知',
                marketing_emails: 'マーケティングメール'
              }).map(([key, label]) => (
                <label key={key} className="flex items-center">
                  <input
                    type="checkbox"
                    checked={notificationSettings[key as keyof typeof notificationSettings]}
                    onChange={(e) => setNotificationSettings({
                      ...notificationSettings,
                      [key]: e.target.checked
                    })}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <span className="ml-2 text-sm text-gray-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-gray-900 mb-3">プッシュ通知</h4>
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={notificationSettings.push_notifications}
                  onChange={(e) => setNotificationSettings({
                    ...notificationSettings,
                    push_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <span className="ml-2 text-sm text-gray-700">プッシュ通知を有効にする</span>
              </label>
              <p className="text-xs text-gray-500 ml-6">
                ブラウザまたはモバイルアプリでのプッシュ通知
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Preferences Tab Component
  const PreferencesTab: React.FC = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">表示設定</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              言語
            </label>
            <select
              value={preferences.language}
              onChange={(e) => setPreferences({ ...preferences, language: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="ja">日本語</option>
              <option value="en">English</option>
              <option value="ko">한국어</option>
              <option value="zh">中文</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              タイムゾーン
            </label>
            <select
              value={preferences.timezone}
              onChange={(e) => setPreferences({ ...preferences, timezone: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="Asia/Tokyo">日本標準時 (JST)</option>
              <option value="Asia/Seoul">韓国標準時 (KST)</option>
              <option value="Asia/Shanghai">中国標準時 (CST)</option>
              <option value="UTC">協定世界時 (UTC)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              通貨
            </label>
            <select
              value={preferences.currency}
              onChange={(e) => setPreferences({ ...preferences, currency: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="JPY">日本円 (¥)</option>
              <option value="USD">米ドル ($)</option>
              <option value="EUR">ユーロ (€)</option>
              <option value="KRW">韓国ウォン (₩)</option>
              <option value="CNY">中国元 (¥)</option>
            </select>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              テーマ
            </label>
            <select
              value={preferences.theme}
              onChange={(e) => setPreferences({ ...preferences, theme: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
              <option value="auto">システム設定に従う</option>
            </select>
          </div>
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">旅行設定</h3>
        
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            旅行スタイル
          </label>
          <select
            value={preferences.travel_style}
            onChange={(e) => setPreferences({ ...preferences, travel_style: e.target.value })}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          >
            <option value="relaxed">リラックス重視</option>
            <option value="active">アクティブ</option>
            <option value="cultural">文化体験重視</option>
            <option value="adventure">アドベンチャー</option>
            <option value="luxury">ラグジュアリー</option>
            <option value="budget">節約重視</option>
          </select>
        </div>
      </div>
    </div>
  );

  // Security Tab Component
  const SecurityTab: React.FC = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-gray-900 mb-4">パスワード変更</h3>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              現在のパスワード
            </label>
            <div className="relative">
              <input
                type={showPasswords.current ? 'text' : 'password'}
                value={passwordData.current_password}
                onChange={(e) => setPasswordData({ ...passwordData, current_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.current ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード
            </label>
            <div className="relative">
              <input
                type={showPasswords.new ? 'text' : 'password'}
                value={passwordData.new_password}
                onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.new ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              新しいパスワード（確認）
            </label>
            <div className="relative">
              <input
                type={showPasswords.confirm ? 'text' : 'password'}
                value={passwordData.confirm_password}
                onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mt-4">
          <p className="text-sm text-yellow-800">
            <strong>注意:</strong> パスワード変更機能は開発中です。
          </p>
        </div>
      </div>
    </div>
  );

  const tabs: SettingsTab[] = [
    { id: 'profile', name: 'プロフィール', icon: <User size={16} />, component: ProfileTab },
    { id: 'notifications', name: '通知', icon: <Bell size={16} />, component: NotificationsTab },
    { id: 'preferences', name: '設定', icon: <Settings size={16} />, component: PreferencesTab },
    { id: 'security', name: 'セキュリティ', icon: <Shield size={16} />, component: SecurityTab },
  ];

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await apiService.updateProfile({
        username: profileData.username || undefined,
        email: profileData.email || undefined,
        preferences: {
          full_name: profileData.full_name,
          bio: profileData.bio,
          notification_settings: notificationSettings,
          ...preferences,
        },
      });
      showMessage('設定を保存しました', 'success');
    } catch (error) {
      console.error('設定保存エラー:', error);
      showMessage(
        error instanceof Error ? error.message : '保存に失敗しました',
        'error'
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = async () => {
    if (confirm('ログアウトしますか？')) {
      try {
        logout();
        navigate('/');
      } catch (error) {
        logout();
        navigate('/');
      }
    }
  };

  const ActiveTabComponent = tabs.find(tab => tab.id === activeTab)?.component || ProfileTab;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-blue-500 hover:text-blue-700 mb-4"
          >
            ← ダッシュボードに戻る
          </button>
          <h1 className="text-3xl font-bold text-gray-900 mb-4">
            ⚙️ 設定
          </h1>
          <p className="text-gray-600">
            アカウント情報、通知設定、プライバシー設定を管理
          </p>
        </div>

        {/* メッセージ表示 */}
        {message && (
          <div className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
            message.type === 'success' 
              ? 'bg-green-100 text-green-800 border border-green-200' 
              : 'bg-red-100 text-red-800 border border-red-200'
          }`}>
            {message.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
            {message.text}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
          {/* サイドバー */}
          <div className="lg:col-span-1">
            <div className="bg-white rounded-xl shadow-sm p-4">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    {tab.icon}
                    <span className="font-medium">{tab.name}</span>
                  </button>
                ))}
                
                <div className="border-t border-gray-200 pt-4 mt-4">
                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} />
                    <span className="font-medium">ログアウト</span>
                  </button>
                </div>
              </nav>
            </div>
          </div>

          {/* メインコンテンツ */}
          <div className="lg:col-span-3">
            <div className="bg-white rounded-xl shadow-sm p-6">
              <ActiveTabComponent />
              
              {/* 保存ボタン */}
              <div className="flex justify-end mt-8 pt-6 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSaving ? (
                    <>
                      <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      保存中...
                    </>
                  ) : (
                    <>
                      <Save size={16} />
                      保存
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;