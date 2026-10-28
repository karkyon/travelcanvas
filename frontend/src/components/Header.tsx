import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Settings,
  User, 
  Bell, 
  Menu, 
  X, 
  Home,
  Calendar,
  Brain,
  LogOut,
  Building2
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useCurrentTripStore } from '../store/currentTripStore';
import { notificationsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import CommandPaletteLauncher from './CommandPaletteLauncher';
import { useThemePreference, type ThemePreference } from '../hooks/useThemePreference';

const THEME_CHOICES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: '明るい' },
  { value: 'dark', label: '暗い' },
  { value: 'system', label: '端末' },
];

const Header: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, isGuest } = useAuthStore();
  const currentPlan = useCurrentTripStore((st) => st.trip);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // [Gate #26] 以前は実データと無関係な固定の未読バッジ(常時点滅)だった。
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    // [Gate R2-6 v6] isGuestを分割代入していたが本effectのガードで一度も
    // 使われておらず、guestユーザーでも/notifications/unread-count
    // (会員限定、backend側はget_current_active_userでguestを明示的に拒否)
    // をポーリングし続けていた。401→axiosインターセプターの
    // /auth/refresh試行→これも401→window.location.href='/login'という
    // 強制リロードが60秒間隔(かつマウント直後にも即時実行)で発生し、
    // ゲストが/plannerに留まっている間ずっと強制ログアウトを繰り返す
    // 実害バグだった(Playwright E2E実行で発覚)。通知は会員限定機能の
    // ため、ゲストの間はポーリング自体を行わないようにする。
    if (!isAuthenticated || isGuest) {
      setUnreadCount(0);
      return;
    }
    const fetchUnreadCount = async () => {
      try {
        const response = await notificationsAPI.getUnreadCount();
        setUnreadCount(response.data?.unread_count ?? 0);
      } catch (error) {
        // 通知バッジの取得失敗はユーザー体験上致命的ではないため、
        // トースト等では通知せずログのみに留める。
        console.error('Failed to fetch unread notification count:', error);
      }
    };
    fetchUnreadCount();
    const interval = setInterval(fetchUnreadCount, 60000);
    return () => clearInterval(interval);
  }, [isAuthenticated, isGuest]);

  const handleLogout = async () => {
    try {
      await logout();
      toast.success('ログアウトしました');
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      toast.error('ログアウトに失敗しました');
    }
  };

  const isActivePath = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  // モバイルメニューとユーザーメニューを外部クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Element;
      if (!target.closest('.user-menu-container')) {
        setIsUserMenuOpen(false);
      }
      if (!target.closest('.mobile-menu-container')) {
        setIsMobileMenuOpen(false);
      }
    };

    if (isUserMenuOpen || isMobileMenuOpen) {
      document.addEventListener('click', handleClickOutside);
      return () => document.removeEventListener('click', handleClickOutside);
    }
    return undefined;
  }, [isUserMenuOpen, isMobileMenuOpen]);

  const navItems = [
    {
      name: 'ダッシュボード',
      path: '/dashboard',
      icon: Home,
      description: 'メインダッシュボード'
    },
    {
      name: 'プランナー',
      path: '/planner',
      icon: Calendar,
      description: '旅行プランの作成・編集'
    },
    {
      name: 'AI検索',
      path: '/search',
      icon: Brain,
      description: 'AIによるスポット検索',
      isNew: true
    }
  ];

  // 認証が必要なページかどうかを判定
  const isAuthRequired = () => {
    const publicPaths = ['/login', '/register', '/forgot-password', '/reset-password'];
    return !publicPaths.some(path => location.pathname.startsWith(path));
  };

  // 認証されていないユーザーには最小限のヘッダーを表示
  if (!isAuthenticated && isAuthRequired()) {
    return (
      <header className="bg-surface shadow-xs border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* ロゴのみ */}
            <div className="flex items-center">
              <Link to="/login" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-linear-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">TC</span>
                </div>
                <span className="text-xl font-bold text-ink-900">
                  TravelCanvas
                </span>
              </Link>
            </div>

            {/* ログイン・登録ボタン */}
            <div className="flex items-center space-x-3">
              <Link
                to="/login"
                className="text-ink-700 hover:text-ink-900 px-3 py-2 rounded-lg transition-colors"
              >
                ログイン
              </Link>
              <Link
                to="/register"
                className="bg-linear-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
              >
                新規登録
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  // 認証されていないユーザーがパブリックページにいる場合も最小限のヘッダー
  if (!isAuthenticated) {
    return (
      <header className="bg-surface shadow-xs border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* ロゴ */}
            <div className="flex items-center">
              <Link to="/login" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-linear-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">TC</span>
                </div>
                <span className="text-xl font-bold text-ink-900">
                  TravelCanvas
                </span>
              </Link>
            </div>

            {/* ログイン・登録ボタン */}
            <div className="flex items-center space-x-3">
              <Link
                to="/login"
                className="text-ink-700 hover:text-ink-900 px-3 py-2 rounded-lg transition-colors"
              >
                ログイン
              </Link>
              <Link
                to="/register"
                className="bg-linear-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
              >
                新規登録
              </Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  // 認証済みユーザー向けのフルヘッダー
  // [Gate G9] UX-3 いつも同じ高さ(h-16)・項目名を折り返さない・「AI検索」を1か所にまとめる・今開いている旅行を示す。
  // 面は決まり(tokens)の glass(見出しの帯)。動きを減らす設定では点滅させない(NEW は静止の印)。
  const tripMatch = /^\/planner\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(location.pathname);
  const currentTrip = tripMatch && currentPlan && currentPlan.id === tripMatch[1] ? currentPlan : null;
  return (
    <header className="tc-surface tc-surface--glass rounded-none border-x-0 border-t-0 sticky top-0 z-50" data-testid="global-header">
      {/* [Gate #35] ゲストセッション中は常時表示するアカウント登録の案内バー。
          データが消えるわけではないが、端末やブラウザを変えると失われるため、
          目立つ位置で「保存」を促す。 */}
      {isGuest && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800">
          ゲストとして利用中です。このブラウザ以外からは続きを見られません。{' '}
          <Link to="/guest/upgrade" className="font-semibold underline underline-offset-2 hover:text-amber-900">
            アカウントを作成して保存する
          </Link>
        </div>
      )}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 h-16">
          {/* ロゴ */}
          <Link to="/dashboard" className="tc-focus-ring flex items-center gap-2 shrink-0 rounded-lg" aria-label="TravelCanvas(ダッシュボードへ)">
            <div className="w-8 h-8 bg-linear-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
              <span className="text-white font-bold text-sm" aria-hidden="true">TC</span>
            </div>
            <span className="text-xl font-bold text-ink-900 hidden xl:block whitespace-nowrap" aria-hidden="true">
              TravelCanvas
            </span>
          </Link>

          {/* デスクトップナビゲーション */}
          <nav className="hidden md:flex items-center gap-1 ml-2 shrink-0" aria-label="主なメニュー">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isActivePath(item.path);
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  className={`tc-focus-ring relative px-3 py-2 rounded-lg flex items-center gap-2 whitespace-nowrap ${
                    isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink-700 hover:text-ink-900 hover:bg-cloud-100'
                  }`}
                  title={item.description}
                >
                  <Icon size={18} aria-hidden="true" />
                  <span className="sr-only lg:hidden">{item.name}</span>
                  <span className="hidden lg:inline font-medium">{item.name}</span>
                  {item.isNew && (
                    <span className="hidden lg:inline text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-accent-soft text-accent-strong">
                      NEW
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* 今開いている旅行(旅行の中にいる時だけ) */}
          {currentTrip && (
            <Link to={`/planner/${currentTrip.id}`} data-testid="header-current-trip"
              className="tc-focus-ring hidden md:inline-flex items-center gap-1 min-w-0 shrink max-w-[16rem] px-3 py-1.5 rounded-full border border-cloud-200 text-sm text-ink-900 hover:bg-cloud-100">
              <span className="text-ink-700 shrink-0">旅行:</span>
              <span className="truncate">{currentTrip.title}</span>
            </Link>
          )}

          <div className="flex-1" />

          {/* [Gate C3] 情報内検索・コマンドパレット(Ctrl+K) */}
          <CommandPaletteLauncher />

          {/* 通知 */}
          <Link
            to="/notifications"
            className="tc-focus-ring p-2 text-ink-700 hover:text-ink-900 hover:bg-cloud-100 rounded-lg relative shrink-0"
            aria-label={unreadCount > 0 ? `通知(未読 ${unreadCount}件)` : '通知'}
            title="通知"
          >
            <Bell size={18} aria-hidden="true" />
            {unreadCount > 0 && (
              <span aria-hidden="true" className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-medium bg-red-700 text-white rounded-full">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>

          {/* ユーザーメニュー */}
          <div className="relative user-menu-container shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setIsUserMenuOpen(!isUserMenuOpen);
              }}
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              className="tc-focus-ring flex items-center gap-2 p-1.5 text-ink-900 hover:bg-cloud-100 rounded-lg"
            >
              <div className="w-8 h-8 bg-linear-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                <User size={16} className="text-white" aria-hidden="true" />
              </div>
              {/* [Gate G9] UX-0 スマホの幅でも名前を読み上げる(見た目は隠す。button-name) */}
              {/* not-sr-only は切り詰め(overflow・nowrap)を打ち消すため、読み上げ用と見た目用を分ける */}
              <span className="sr-only xl:hidden">{isGuest ? 'ゲスト' : (user?.username || 'ユーザー')}</span>
              <span className="hidden xl:inline-block font-medium max-w-[10rem] truncate align-middle">{isGuest ? 'ゲスト' : (user?.username || 'ユーザー')}</span>
            </button>

            {/* ユーザードロップダウン */}
            {isUserMenuOpen && (
              <div className="absolute right-0 mt-2 w-60 bg-cloud-0 text-ink-900 rounded-lg shadow-lg border border-cloud-200 py-1 z-10">
                <div className="px-4 py-2 border-b border-cloud-200">
                  <p className="text-sm font-medium text-ink-900 truncate">
                    {user?.username}
                  </p>
                  <p className="text-xs text-ink-700 truncate">
                    {user?.email}
                  </p>
                </div>

                <Link
                  to="/profile"
                  className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
                  onClick={() => setIsUserMenuOpen(false)}
                >
                  <User size={16} className="inline mr-2" aria-hidden="true" />
                  プロフィール
                </Link>
                {/* [Gate B1] 組織(FR-041)。ゲストは使えない */}
                {user?.user_type !== 'guest' && (
                  <Link
                    to="/organizations"
                    className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Building2 size={16} className="inline mr-2" aria-hidden="true" />
                    組織
                  </Link>
                )}
                <Link
                  to="/settings"
                  className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
                  onClick={() => setIsUserMenuOpen(false)}
                >
                  <Settings size={16} className="inline mr-2" aria-hidden="true" />
                  設定
                </Link>
                <Link
                  to="/search/settings"
                  className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
                  onClick={() => setIsUserMenuOpen(false)}
                >
                  <Brain size={16} className="inline mr-2" aria-hidden="true" />
                  AI検索設定
                </Link>
                {/* [Gate G10-UX] UX-8 見た目の切り替え(この端末。全ての画面に効く) */}
                <div className="px-4 py-2 border-t border-cloud-200" role="group" aria-label="表示">
                  <p className="text-xs text-ink-700 mb-1" aria-hidden="true">表示</p>
                  <div className="flex gap-1">
                    {THEME_CHOICES.map((c) => (
                      <button
                        key={c.value}
                        type="button"
                        aria-pressed={themePreference === c.value}
                        onClick={(e) => { e.stopPropagation(); setThemePreference(c.value); }}
                        className={`tc-focus-ring flex-1 min-h-9 px-2 rounded-md text-xs font-medium border ${themePreference === c.value
                          ? 'bg-accent text-on-accent border-accent' : 'bg-cloud-0 text-ink-900 border-cloud-200 hover:bg-cloud-100'}`}
                      >
                        {c.label}
                      </button>
                    ))}
                  </div>
                </div>
                <hr className="my-1 border-cloud-200" />
                <button
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    handleLogout();
                  }}
                  className="block w-full text-left px-4 py-2 text-sm text-danger hover:bg-danger-soft transition-colors"
                >
                  <LogOut size={16} className="inline mr-2" aria-hidden="true" />
                  ログアウト
                </button>
              </div>
            )}
          </div>

          {/* モバイルメニューボタン */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMobileMenuOpen(!isMobileMenuOpen);
            }}
            className="tc-focus-ring md:hidden p-2 text-ink-700 hover:text-ink-900 hover:bg-cloud-100 rounded-lg shrink-0"
            aria-label={isMobileMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        {/* モバイルメニュー */}
        {isMobileMenuOpen && (
          <nav className="md:hidden border-t border-cloud-200 mobile-menu-container" aria-label="主なメニュー(スマホ)">
            <ul className="py-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isActivePath(item.path);
                return (
                  <li key={item.path}>
                    <Link
                      to={item.path}
                      aria-current={isActive ? 'page' : undefined}
                      className={`tc-focus-ring flex items-center gap-3 px-4 py-3 text-base font-medium rounded-lg mx-2 ${
                        isActive ? 'bg-accent-soft text-accent-strong' : 'text-ink-700 hover:text-ink-900 hover:bg-cloud-100'
                      }`}
                      onClick={() => setIsMobileMenuOpen(false)}
                    >
                      <Icon size={20} aria-hidden="true" />
                      <span>{item.name}</span>
                    </Link>
                  </li>
                );
              })}
              {currentTrip && (
                <li>
                  <Link to={`/planner/${currentTrip.id}`} onClick={() => setIsMobileMenuOpen(false)}
                    className="tc-focus-ring flex items-center gap-2 px-4 py-3 text-base rounded-lg mx-2 text-ink-900 hover:bg-cloud-100">
                    <span className="text-ink-700">旅行:</span><span className="truncate">{currentTrip.title}</span>
                  </Link>
                </li>
              )}
              <li>
                <Link
                  to="/search/settings"
                  className="tc-focus-ring flex items-center gap-3 px-4 py-3 text-base font-medium text-ink-700 hover:text-ink-900 hover:bg-cloud-100 rounded-lg mx-2"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Settings size={20} aria-hidden="true" />
                  <span>AI検索設定</span>
                </Link>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
};

export default Header;