import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  User, Bell, Shield, Settings, LogOut, Save, 
  CheckCircle, AlertCircle, Eye, EyeOff, Download, Trash2, Lock, LifeBuoy, Gauge
} from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { api as apiService, getOfflinePackKey, rotateOfflinePackKey } from '@/services/api';
import { forgetOfflineKeys, obtainOfflineKey } from '@/utils/offlineVault';
import { currentOfflineSession } from '@/utils/offlineSession';
import Button from '@/components/common/Button';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import ActiveSessionsSection from '@/components/settings/ActiveSessionsSection';
import MfaSection from '@/components/settings/MfaSection';
import PrivateProfileSection from '@/components/settings/PrivateProfileSection';
import SupportAccessSection from '@/components/settings/SupportAccessSection';
import UsageSection from '@/components/settings/UsageSection';
import StylePicker from '@/components/settings/StylePicker';
import { useStylePreference, useThemeStore } from '@/hooks/useThemePreference';
import {
  listOfflinePacks,
  deleteOfflinePack,
  clearAllOfflinePacks,
  type OfflinePackSummary,
} from '@/utils/offlinePack';
import UiIcon from '@/components/common/UiIcon';
import { IcSettings } from '@/components/common/uiIcons';

interface SettingsTab {
  id: string;
  name: string;
  icon: React.ReactNode;
  // [Gate S9] タブの中身を描く関数(部品ではない)。以前は <ActiveTabComponent /> で描いていたため、
  // 描画のたびに別の部品として作り直され、入力欄が1文字ごとにフォーカスを失っていた(SettingsPage.test.tsx)
  render: () => React.ReactElement;
}

const SettingsPage: React.FC = () => {
  const navigate = useNavigate();
  const { user, logout, isGuest } = useAuthStore();
  // [Gate S11] ?tab=security で開く(管理者の画面の「多要素認証を設定する」から来た時)
  const [searchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => searchParams.get('tab') || 'profile');
  const [isSaving, setIsSaving] = useState(false);
  // [Gate #21] パスワード変更は「開発中」表示で無効化されていた。
  // backend/app/api/v1/auth.pyに/auth/change-passwordを新規実装したのに
  // 合わせて実際に呼び出す。
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  
  const [profileData, setProfileData] = useState({
    full_name: user?.username || '',
    email: user?.email || '',
    username: user?.username || '',
    bio: ''
  });
  // [Gate S2] メールアドレスの変更には現在のパスワードでの再認証が必要(乗っ取られた端末から連絡先を奪わせない)
  const [emailChangePassword, setEmailChangePassword] = useState('');
  const emailChanging = !!profileData.email && profileData.email !== (user?.email || '');
  
  const [notificationSettings, setNotificationSettings] = useState({
    email_notifications: true,
    push_notifications: true,
    plan_updates: true,
    collaboration_invites: true,
    optimization_complete: true,
    system_maintenance: false,
    marketing_emails: false
  });
  
  // [Gate G10-UX] UX-8 テーマはこの端末にすぐ当てる(以前はサーバーに保存するだけで、画面には何も効いていなかった)
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  // [Gate G11] 見た目の系統(保存の内容に今の系統を入れ、古い値でアカウントを上書きしない)
  const { style: uiStyle } = useStylePreference();
  const [preferences, setPreferences] = useState({
    language: 'ja',
    timezone: 'Asia/Tokyo',
    currency: 'JPY',
    theme: 'light',
    travel_style: 'balanced',
    ui_style: uiStyle as string,
  });

  // [Gate #20] 以前は保存ボタンがsetTimeoutで成功を偽装するだけで、
  // 実際にはどこにも保存されず、画面初期値も常に固定のデフォルト値だった。
  // GET /auth/me(今回新規実装)から実際に保存済みのpreferencesを読み込む。
  useEffect(() => {
    (async () => {
      try {
        const response = await apiService.getCurrentUser();
        const saved = response.data?.preferences as Record<string, unknown> | undefined;
        if (saved) {
          if (saved.full_name || saved.bio) {
            setProfileData((prev) => ({
              ...prev,
              full_name: (saved.full_name as string | undefined) ?? prev.full_name,
              bio: (saved.bio as string | undefined) ?? prev.bio,
            }));
          }
          if (saved.notification_settings) {
            setNotificationSettings((prev) => ({ ...prev, ...(saved.notification_settings as Record<string, unknown>) }));
          }
          const { full_name, bio, notification_settings, ...rest } = saved;
          void full_name;
          void bio;
          void notification_settings;
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
  const ProfileTab = (): React.ReactElement => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ink-900 mb-4">プロフィール情報</h3>
        
        {/* Avatar */}
        <div className="flex items-center gap-4 mb-6">
          <div className="relative">
            <div className="w-20 h-20 rounded-full bg-gray-200 flex items-center justify-center">
              <User size={32} className="text-gray-400" />
            </div>
          </div>
          <div>
            <p className="text-sm text-ink-700">プロフィール画像</p>
            <p className="text-xs text-ink-500">JPG、PNG、最大2MB</p>
          </div>
        </div>

        {/* Form Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label htmlFor="profile-full-name" className="block text-sm font-medium text-ink-700 mb-1">
              フルネーム
            </label>
            <input
              id="profile-full-name"
              type="text"
              value={profileData.full_name}
              onChange={(e) => setProfileData({ ...profileData, full_name: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div>
            <label htmlFor="profile-username" className="block text-sm font-medium text-ink-700 mb-1">
              ユーザー名
            </label>
            <input
              id="profile-username"
              type="text"
              value={profileData.username}
              onChange={(e) => setProfileData({ ...profileData, username: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          
          <div className="md:col-span-2">
            <label htmlFor="profile-email" className="block text-sm font-medium text-ink-700 mb-1">
              メールアドレス
            </label>
            <input
              id="profile-email"
              type="email"
              value={profileData.email}
              onChange={(e) => setProfileData({ ...profileData, email: e.target.value })}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>

          {emailChanging && (
            <div className="md:col-span-2">
              <label htmlFor="email-change-password" className="block text-sm font-medium text-ink-700 mb-1">
                現在のパスワード(メールアドレスの変更に必要)
              </label>
              <input
                id="email-change-password"
                type="password"
                autoComplete="current-password"
                value={emailChangePassword}
                onChange={(e) => setEmailChangePassword(e.target.value)}
                aria-describedby="email-change-note"
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <p id="email-change-note" className="mt-1 text-xs text-ink-700">
                変更すると、メールアドレスは未確認の状態になり、ほかの端末はログアウトされます。
              </p>
            </div>
          )}
          
          <div className="md:col-span-2">
            <label htmlFor="profile-bio" className="block text-sm font-medium text-ink-700 mb-1">
              自己紹介
            </label>
            <textarea
              id="profile-bio"
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
  const NotificationsTab = (): React.ReactElement => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ink-900 mb-4">通知設定</h3>
        
        <div className="space-y-4">
          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-ink-900 mb-3">メール通知</h4>
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
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded-sm"
                  />
                  <span className="ml-2 text-sm text-ink-700">{label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border border-gray-200 rounded-lg p-4">
            <h4 className="font-medium text-ink-900 mb-3">プッシュ通知</h4>
            <div className="space-y-3">
              <label className="flex items-center">
                <input
                  type="checkbox"
                  checked={notificationSettings.push_notifications}
                  onChange={(e) => setNotificationSettings({
                    ...notificationSettings,
                    push_notifications: e.target.checked
                  })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded-sm"
                />
                <span className="ml-2 text-sm text-ink-700">プッシュ通知を有効にする</span>
              </label>
              <p className="text-xs text-ink-500 ml-6">
                ブラウザまたはモバイルアプリでのプッシュ通知
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  // Preferences Tab Component
  const PreferencesTab = (): React.ReactElement => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ink-900 mb-4">表示設定</h3>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink-700 mb-1" htmlFor="settings-language">
              言語
            </label>
            <select
              id="settings-language"
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
            <label className="block text-sm font-medium text-ink-700 mb-1" htmlFor="settings-timezone">
              タイムゾーン
            </label>
            <select
              id="settings-timezone"
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
            <label className="block text-sm font-medium text-ink-700 mb-1" htmlFor="settings-currency">
              通貨
            </label>
            <select
              id="settings-currency"
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
            <label className="block text-sm font-medium text-ink-700 mb-1" htmlFor="settings-theme">
              テーマ
            </label>
            <select
              id="settings-theme"
              value={themePreference === 'system' ? 'auto' : themePreference}
              onChange={(e) => {
                const v = e.target.value;
                setThemePreference((v === 'auto' ? 'system' : v) as ThemePreference);
                setPreferences({ ...preferences, theme: v });
              }}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            >
              <option value="light">ライト</option>
              <option value="dark">ダーク</option>
              <option value="auto">システム設定に従う</option>
            </select>
          </div>

          <StylePicker onChange={(v) => setPreferences((prev) => ({ ...prev, ui_style: v }))} />
        </div>
      </div>

      <div>
        <h3 className="text-lg font-semibold text-ink-900 mb-4">旅行設定</h3>
        
        <div>
          <label className="block text-sm font-medium text-ink-700 mb-1" htmlFor="settings-travel-style">
            旅行スタイル
          </label>
          <select
            id="settings-travel-style"
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
  const SecurityTab = (): React.ReactElement => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-ink-900 mb-4">パスワード変更</h3>
        
        <div className="space-y-4">
          <div>
            <label htmlFor="current-password" className="block text-sm font-medium text-ink-700 mb-1">
              現在のパスワード
            </label>
            <div className="relative">
              <input
                id="current-password"
                autoComplete="current-password"
                type={showPasswords.current ? 'text' : 'password'}
                value={passwordData.current_password}
                onChange={(e) => setPasswordData({ ...passwordData, current_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                aria-label={showPasswords.current ? '現在のパスワードを隠す' : '現在のパスワードを表示'}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.current ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <div>
            <label htmlFor="new-password" className="block text-sm font-medium text-ink-700 mb-1">
              新しいパスワード
            </label>
            <div className="relative">
              <input
                id="new-password"
                autoComplete="new-password"
                type={showPasswords.new ? 'text' : 'password'}
                value={passwordData.new_password}
                onChange={(e) => setPasswordData({ ...passwordData, new_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                aria-label={showPasswords.new ? '新しいパスワードを隠す' : '新しいパスワードを表示'}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.new ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          
          <div>
            <label htmlFor="confirm-new-password" className="block text-sm font-medium text-ink-700 mb-1">
              新しいパスワード（確認）
            </label>
            <div className="relative">
              <input
                id="confirm-new-password"
                autoComplete="new-password"
                type={showPasswords.confirm ? 'text' : 'password'}
                value={passwordData.confirm_password}
                onChange={(e) => setPasswordData({ ...passwordData, confirm_password: e.target.value })}
                className="w-full px-3 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
              <button
                type="button"
                onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                aria-label={showPasswords.confirm ? '確認のパスワードを隠す' : '確認のパスワードを表示'}
                className="absolute inset-y-0 right-0 pr-3 flex items-center"
              >
                {showPasswords.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4">
          <Button
            variant="primary"
            onClick={handleChangePassword}
            loading={isChangingPassword}
          >
            パスワードを変更
          </Button>
        </div>
      </div>

      {/* [Gate S11] 多要素認証(認証アプリ)。管理者は必須 */}
      <MfaSection />

      {/* [Gate S9] ログイン中の端末(新しい端末からのログインは通知でも知らせる) */}
      <ActiveSessionsSection />
    </div>
  );

  // [Gate #36] オフラインパック管理タブ
  const [offlinePacks, setOfflinePacks] = useState<OfflinePackSummary[]>([]);
  const [isLoadingPacks, setIsLoadingPacks] = useState(false);

  const [isRevokingDevices, setIsRevokingDevices] = useState(false);
  const [revokeStatus, setRevokeStatus] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const refreshOfflinePacks = async () => {
    setIsLoadingPacks(true);
    try {
      // [Gate K1] この利用者のものだけを表示する(同じ端末で別の利用者が保存したものは出さない)
      const packs = await listOfflinePacks(currentOfflineSession()?.userId);
      setOfflinePacks(packs);
    } catch (error) {
      console.error('Failed to list offline packs:', error);
    } finally {
      setIsLoadingPacks(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'offline') {
      refreshOfflinePacks();
    }
  }, [activeTab]);

  const handleDeletePack = async (planId: string) => {
    await deleteOfflinePack(planId);
    await refreshOfflinePacks();
  };

  const handleClearAllPacks = async () => {
    if (!window.confirm('保存済みのオフラインデータをすべて削除します。よろしいですか?')) {
      return;
    }
    await clearAllOfflinePacks();
    await refreshOfflinePacks();
  };

  // [Gate K1] B-008 失効: 鍵の版を上げ、これまでの鍵を全て無効にする。端末を無くした時などに使う。
  // ほかの端末のデータは、その端末が次に鍵を受け取った時に消える(通信しないままの端末からは遠隔で消せない)。
  const handleRevokeAllDevices = async () => {
    if (!window.confirm(
      '全ての端末に保存したオフラインデータを無効にします。この端末のデータも消え、元に戻せません。よろしいですか?',
    )) {
      return;
    }
    setIsRevokingDevices(true);
    setRevokeStatus(null);
    try {
      const current = await getOfflinePackKey();
      await rotateOfflinePackKey(current.key_version);
      await forgetOfflineKeys();
      await clearAllOfflinePacks();
      await obtainOfflineKey(currentOfflineSession(), { refresh: true });
      setRevokeStatus({
        type: 'success',
        text: '全ての端末のオフラインデータを無効にしました。ほかの端末のデータは、その端末が次に通信した時に消えます。',
      });
      await refreshOfflinePacks();
    } catch (error) {
      const status = (error as { response?: { status?: number } } | null)?.response?.status;
      setRevokeStatus({
        type: 'error',
        text: status === 409
          ? '別の端末で先に無効化されました。画面を読み込み直してください。'
          : '無効にできませんでした。通信を確認して、もう一度お試しください。',
      });
    } finally {
      setIsRevokingDevices(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const OfflineTab = () => (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-ink-900 mb-2">オフラインデータ</h3>
        <p className="text-sm text-ink-700 mb-4">
          プランナー画面の「オフラインで使う」で保存したプランがここに表示されます。
          この端末に暗号化して保存されており、7日間で自動的に失効します。
          ログアウトすると、次にログインするまで開けなくなります。
        </p>
      </div>

      {isLoadingPacks ? (
        <p className="text-sm text-ink-700">読み込み中...</p>
      ) : offlinePacks.length === 0 ? (
        <p className="text-sm text-ink-700">保存されているオフラインデータはありません。</p>
      ) : (
        <div className="space-y-3" role="list" aria-label="保存したオフラインデータ">
          {offlinePacks.map((pack) => (
            <div
              role="listitem"
              key={pack.planId}
              className="flex items-center justify-between p-4 bg-gray-50 rounded-lg border border-gray-200"
            >
              <div className="min-w-0">
                <p className="font-medium text-ink-900 truncate">{pack.planTitle}</p>
                <p className="text-xs text-ink-700">
                  {formatBytes(pack.approxSizeBytes)} ・
                  {new Date(pack.expiresAt).toLocaleDateString('ja-JP')}まで有効
                </p>
              </div>
              <button
                onClick={() => handleDeletePack(pack.planId)}
                className="p-2 text-ink-700 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                title="このオフラインデータを削除"
                aria-label={`「${pack.planTitle}」のオフラインデータを削除`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
      )}

      {offlinePacks.length > 0 && (
        <Button variant="ghost" onClick={handleClearAllPacks}>
          <Trash2 size={16} className="inline mr-2" />
          すべてのオフラインデータを削除
        </Button>
      )}

      <section aria-labelledby="offline-revoke-heading" className="border-t pt-6">
        <h3 id="offline-revoke-heading" className="text-base font-medium text-ink-900 mb-2">
          端末を無くした時は
        </h3>
        <p className="text-sm text-ink-700 mb-3">
          全ての端末に保存したオフラインデータを読めなくします。ほかの端末のデータは、その端末が次に通信した時に消えます。
        </p>
        <Button variant="danger" onClick={handleRevokeAllDevices} loading={isRevokingDevices}>
          全ての端末のオフラインデータを無効にする
        </Button>
        {revokeStatus && (
          <p
            role={revokeStatus.type === 'error' ? 'alert' : 'status'}
            className={`mt-3 text-sm ${revokeStatus.type === 'error' ? 'text-red-700' : 'text-green-800'}`}
          >
            {revokeStatus.text}
          </p>
        )}
      </section>
    </div>
  );

  const tabs: SettingsTab[] = [
    { id: 'profile', name: 'プロフィール', icon: <User size={16} />, render: ProfileTab },
    { id: 'notifications', name: '通知', icon: <Bell size={16} />, render: NotificationsTab },
    { id: 'preferences', name: '設定', icon: <Settings size={16} />, render: PreferencesTab },
    { id: 'security', name: 'セキュリティ', icon: <Shield size={16} />, render: SecurityTab },
    { id: 'offline', name: 'オフライン', icon: <Download size={16} />, render: OfflineTab },
    // [Gate C1] FR-023 秘匿プロフィール(本人だけ)
    { id: 'conditions', name: '非公開の条件', icon: <Lock size={16} />, render: () => <PrivateProfileSection /> },
    // [Gate G2] FR-040 サポートへの閲覧の許可(本人が目的・期限つきで許可する)
    { id: 'support', name: 'サポート', icon: <LifeBuoy size={16} />, render: () => <SupportAccessSection /> },
    // [Gate G5] BILL-02 今月の使用量と上限
    { id: 'usage', name: '使用量', icon: <Gauge size={16} />, render: () => <UsageSection /> },
  ];

  const handleSave = async () => {
    if (isGuest) return;  // ゲストは保存のボタンを出さない(上の案内)
    setIsSaving(true);
    try {
      if (emailChanging && !emailChangePassword) {
        showMessage('メールアドレスを変更するには、現在のパスワードを入力してください', 'error');
        return;
      }
      const saved = await apiService.updateProfile({
        username: profileData.username || undefined,
        email: profileData.email || undefined,
        current_password: emailChanging ? emailChangePassword : undefined,
        preferences: {
          full_name: profileData.full_name,
          bio: profileData.bio,
          notification_settings: notificationSettings,
          ...preferences,
          ui_style: useThemeStore.getState().style,
        },
      });
      if (emailChanging) {
        setEmailChangePassword('');
        const current = useAuthStore.getState().user;
        if (current) useAuthStore.setState({ user: { ...current, email: saved.data.email } });
        showMessage('メールアドレスを変更しました。ほかの端末はログアウトされました', 'success');
      } else {
        showMessage('設定を保存しました', 'success');
      }
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

  const handleChangePassword = async () => {
    if (!passwordData.current_password || !passwordData.new_password) {
      showMessage('現在のパスワードと新しいパスワードを入力してください', 'error');
      return;
    }
    if (passwordData.new_password !== passwordData.confirm_password) {
      showMessage('新しいパスワードが一致しません', 'error');
      return;
    }
    if (passwordData.new_password.length < 8) {
      showMessage('新しいパスワードは8文字以上にしてください', 'error');
      return;
    }
    setIsChangingPassword(true);
    try {
      await apiService.changePassword({
        current_password: passwordData.current_password,
        new_password: passwordData.new_password,
      });
      setPasswordData({ current_password: '', new_password: '', confirm_password: '' });
      showMessage('パスワードを変更しました', 'success');
    } catch (error) {
      console.error('パスワード変更エラー:', error);
      showMessage(
        error instanceof Error ? error.message : 'パスワードの変更に失敗しました',
        'error'
      );
    } finally {
      setIsChangingPassword(false);
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

  const renderActiveTab = tabs.find(tab => tab.id === activeTab)?.render || ProfileTab;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* ヘッダー */}
        <div className="mb-8">
          <button
            onClick={() => navigate('/dashboard')}
            className="text-blue-700 hover:text-blue-900 mb-4"
          >
            ← ダッシュボードに戻る
          </button>
          <h1 className="text-3xl font-bold text-ink-900 mb-4">
            <UiIcon icon={IcSettings} size={28} className="mr-2 align-[-4px]" />設定
          </h1>
          <p className="text-ink-700">
            アカウント情報、通知設定、プライバシー設定を管理
          </p>
        </div>

        {/* [Gate Honesty] 監査 Gate App UX: 以前はゲストが入力して保存を押した後に「ログインが必要」と知らせていた。
            保存できないことを先に示し、入力は消さない(保存のボタンの代わりにアカウントを作る入口を出す) */}
        {isGuest && (
          <div role="note" className="mb-6 p-4 rounded-lg border border-amber-200 bg-amber-50 text-amber-900 text-sm" data-testid="settings-guest-notice">
            <p className="font-semibold">ゲストの間は、アカウントの設定(名前・メール・通知・パスワードなど)を保存できません。</p>
            <p className="mt-1">
              見た目(明るい・暗い・系統)はこの端末にすぐ反映されます。入力した内容はこの画面にいる間は残ります。
              アカウントを作ると、旅行もそのまま引き継いで保存できます。
            </p>
            <div className="mt-2 flex flex-wrap gap-3">
              <Link to="/guest/upgrade" className="font-semibold underline underline-offset-2">アカウントを作って保存する</Link>
              <Link to="/login" className="underline underline-offset-2">登録済みの方はログイン</Link>
            </div>
          </div>
        )}

        {/* メッセージ表示 */}
        {message && (
          <div role={message.type === 'error' ? 'alert' : 'status'} className={`mb-6 p-4 rounded-lg flex items-center gap-2 ${
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
            <div className="bg-surface rounded-xl shadow-xs p-4">
              <nav className="space-y-1">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg transition-colors ${
                      activeTab === tab.id
                        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                        : 'text-ink-700 hover:bg-gray-50'
                    }`}
                  >
                    {tab.icon}
                    <span className="font-medium">{tab.name}</span>
                  </button>
                ))}
                
                {/* [Gate P6] FR-039 データの書き出しと保持期間 / [Gate P9] 同意・アカウントの削除 */}
                <button
                  onClick={() => navigate('/settings/data')}
                  className="w-full flex items-center gap-3 px-3 py-2 text-left rounded-lg text-ink-700 hover:bg-gray-50 transition-colors"
                >
                  <Download size={16} />
                  <span className="font-medium">データとプライバシー</span>
                </button>

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
            <div className="bg-surface rounded-xl shadow-xs p-6">
              {renderActiveTab()}
              
              {/* 保存ボタン([Gate C1] 非公開の条件のタブは自分の保存ボタンを持つため出さない) */}
              {activeTab !== 'conditions' && isGuest && (
                <div className="flex flex-wrap items-center justify-end gap-3 mt-8 pt-6 border-t border-gray-200" data-testid="settings-guest-save">
                  <p className="text-sm text-ink-700">ゲストの間は保存できません。</p>
                  <Link to="/guest/upgrade" className="tc-focus-ring tc-mbtn tc-mbtn--primary">アカウントを作って保存する</Link>
                </div>
              )}
              {activeTab !== 'conditions' && !isGuest && <div className="flex justify-end mt-8 pt-6 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
              </div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;