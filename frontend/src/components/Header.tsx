import React, { Suspense, lazy, useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Bell, Menu, X, MapPinned, ChevronDown } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { useCurrentTripStore } from '../store/currentTripStore';
import { notificationsAPI } from '../services/api';
import { toast } from 'react-hot-toast';
import CommandPaletteLauncher from './CommandPaletteLauncher';

// [Gate AppShell] 利用者のメニュー・スマホのメニューは開いた時に読む(最初に読む JS を増やさない)
const loadMenus = () => import('./shell/HeaderMenus');
const UserMenu = lazy(() => loadMenus().then((m) => ({ default: m.UserMenu })));
const MobileMenu = lazy(() => loadMenus().then((m) => ({ default: m.MobileMenu })));

const Header: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated, isGuest } = useAuthStore();
  const currentPlan = useCurrentTripStore((st) => st.trip);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
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

  // 認証されていないユーザーには最小限のヘッダー(印・ログイン・新規登録)を表示
  if (!isAuthenticated) {
    return (
      <header className="bg-surface shadow-xs border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <Link to="/login" className="flex items-center space-x-2">
              <span className="tc-brandmark" aria-hidden="true">✦</span>
              <span className="text-xl font-bold text-ink-900">TravelCanvas</span>
            </Link>
            <div className="flex items-center space-x-3">
              <Link to="/login" className="text-ink-700 hover:text-ink-900 px-3 py-2 rounded-lg transition-colors">ログイン</Link>
              <Link to="/register" className="tc-mbtn tc-mbtn--primary">新規登録</Link>
            </div>
          </div>
        </div>
      </header>
    );
  }

  // 認証済みユーザー向けのフルヘッダー
  // [Gate AppShell] UI/UX モックの上の帯(72px): 印・今の旅行の切り替え・検索・通知・利用者。
  // 画面の移動は左の帯(AppRail、スマホでは下の帯)へ移した。スマホの下の帯に出ない項目は「メニュー」から開く。
  const tripMatch = /^\/planner\/([0-9a-fA-F-]{36})(?:\/|$)/.exec(location.pathname);
  const currentTrip = tripMatch && currentPlan && currentPlan.id === tripMatch[1] ? currentPlan : null;
  const tripDates = currentTrip ? tripDateText(currentTrip.start_date, currentTrip.end_date) : '';
  const displayName = isGuest ? 'ゲスト' : (user?.username || 'ユーザー');
  return (
    <>
      {/* [Gate #35] ゲストセッション中は常時表示するアカウント登録の案内バー(上の帯の上。読み進めると流れる) */}
      {isGuest && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2 text-center text-sm text-amber-800" data-testid="guest-banner">
          ゲストとして利用中です。このブラウザ以外からは続きを見られません。{' '}
          <Link to="/guest/upgrade" className="font-semibold underline underline-offset-2 hover:text-amber-900">
            アカウントを作成して保存する
          </Link>
        </div>
      )}
      <header className="tc-topbar" data-testid="global-header">
        <div className="tc-topbar-row">
          <Link to="/dashboard" className="tc-focus-ring tc-brand" aria-label="TravelCanvas(ホームへ)">
            <span className="tc-brandmark" aria-hidden="true">✦</span>
            <span className="tc-brand-text" aria-hidden="true">TravelCanvas</span>
          </Link>

          {/* 今開いている旅行(旅行の中にいる時)。それ以外は旅行の一覧へ */}
          {currentTrip ? (
            <Link to={`/planner/${currentTrip.id}`} data-testid="header-current-trip" className="tc-focus-ring tc-trip-switch"
              aria-label={`今の旅行: ${currentTrip.title}${tripDates ? `(${tripDates})` : ''}`}>
              <MapPinned size={18} aria-hidden="true" className="shrink-0" />
              <span className="tc-trip-name">
                <span>{currentTrip.title}</span>
                {tripDates && <small>{tripDates}</small>}
              </span>
              <ChevronDown size={16} aria-hidden="true" className="tc-chev" />
            </Link>
          ) : (
            <Link to="/planner" className="tc-focus-ring tc-trip-switch" data-testid="header-trip-picker">
              <MapPinned size={18} aria-hidden="true" className="shrink-0" />
              <span className="tc-trip-name"><span>旅行を選ぶ</span><small>旅程の一覧へ</small></span>
              <ChevronDown size={16} aria-hidden="true" className="tc-chev" />
            </Link>
          )}

          <div className="flex-1 tc-top-spacer" />

          {/* [Gate C3] 情報内検索・コマンドパレット(Ctrl+K) */}
          <div className="hidden sm:block shrink-0"><CommandPaletteLauncher /></div>

          {/* 通知 */}
          <Link
            to="/notifications"
            className="tc-focus-ring tc-top-icon"
            aria-label={unreadCount > 0 ? `通知(未読 ${unreadCount}件)` : '通知'}
            title="通知"
          >
            <Bell size={18} aria-hidden="true" />
            {unreadCount > 0 && (
              <span aria-hidden="true" className="absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-medium bg-red-700 text-white rounded-full">
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
              onPointerEnter={() => { void loadMenus(); }}
              onFocus={() => { void loadMenus(); }}
              aria-haspopup="menu"
              aria-expanded={isUserMenuOpen}
              className="tc-focus-ring flex items-center gap-2 rounded-full"
            >
              <span className="tc-avatar" aria-hidden="true">{displayName.slice(0, 1).toUpperCase()}</span>
              <span className="sr-only">{displayName}</span>
            </button>

            {isUserMenuOpen && (
              <Suspense fallback={null}>
                <UserMenu onClose={() => setIsUserMenuOpen(false)} onLogout={handleLogout} />
              </Suspense>
            )}
          </div>

          {/* スマホ: 下の帯に出ない項目もここから開く */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              setIsMobileMenuOpen(!isMobileMenuOpen);
            }}
            className="tc-focus-ring tc-top-icon tc-menu-btn"
            aria-label={isMobileMenuOpen ? 'メニューを閉じる' : 'メニューを開く'}
            aria-expanded={isMobileMenuOpen}
          >
            {isMobileMenuOpen ? <X size={20} aria-hidden="true" /> : <Menu size={20} aria-hidden="true" />}
          </button>
        </div>

        {/* スマホのメニュー(全ての項目)。開いた時に読み込む */}
        {isMobileMenuOpen && (
          <Suspense fallback={null}>
            <MobileMenu pathname={location.pathname} tripId={currentPlan?.id ?? null} onClose={() => setIsMobileMenuOpen(false)} />
          </Suspense>
        )}
      </header>
    </>
  );
};

/** 旅行の日付(「11月14日 — 16日」の形)。日付が無ければ空 */
function tripDateText(start?: string | null, end?: string | null): string {
  const p = (d?: string | null) => (d && /^\d{4}-\d{2}-\d{2}/.test(d) ? { m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) } : null);
  const a = p(start);
  const b = p(end);
  if (!a) return '';
  if (!b || (a.m === b.m && a.d === b.d)) return `${a.m}月${a.d}日`;
  return a.m === b.m ? `${a.m}月${a.d}日 — ${b.d}日` : `${a.m}月${a.d}日 — ${b.m}月${b.d}日`;
}

export default Header;