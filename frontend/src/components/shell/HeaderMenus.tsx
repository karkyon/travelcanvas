/**
 * [Gate AppShell] 上の帯のメニュー(利用者のメニュー・スマホのメニュー)。開いた時に読み込む別の塊。
 * 中身は以前の Header と同じ(プロフィール・組織・設定・検索の設定・ログアウト)。見た目は上の帯の印([Gate HeaderPicker])。
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Settings, User, Brain, LogOut, Building2, ShieldCheck, Activity } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { railItems } from './railItems';
import { safeInternalPath } from '../../utils/safeNavigation';

// [Gate HeaderPicker] 旅行の一覧・見た目の切り替えも同じ塊で読む(最初に読む JS の入口を増やさない)
export { default as TripPickerMenu } from './TripPickerMenu';
export { default as ThemeToggle } from './ThemeToggle';

export const UserMenu: React.FC<{ onClose: () => void; onLogout: () => void }> = ({ onClose, onLogout }) => {
  const { user, isGuest } = useAuthStore();
  const isAdmin = !isGuest && (user?.user_type === 'admin' || user?.user_type === 'super_admin' || user?.is_superuser === true);
  return (
    <div className="absolute right-0 mt-2 w-60 bg-cloud-0 text-ink-900 rounded-lg shadow-lg border border-cloud-200 py-1 z-10">
      <div className="px-4 py-2 border-b border-cloud-200">
        <p className="text-sm font-medium text-ink-900 truncate">
          {isGuest ? 'ゲスト' : user?.username}
        </p>
        <p className="text-xs text-ink-700 truncate">
          {isGuest ? 'このブラウザだけに保存しています' : user?.email}
        </p>
      </div>

      <Link
        to="/profile"
        className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
        onClick={onClose}
      >
        <User size={16} className="inline mr-2" aria-hidden="true" />
        プロフィール
      </Link>
      {/* [Gate B1] 組織(FR-041)。ゲストは使えない */}
      {user?.user_type !== 'guest' && (
        <Link
          to="/organizations"
          className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
          onClick={onClose}
        >
          <Building2 size={16} className="inline mr-2" aria-hidden="true" />
          組織
        </Link>
      )}
      <Link
        to="/settings"
        className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
        onClick={onClose}
      >
        <Settings size={16} className="inline mr-2" aria-hidden="true" />
        設定
      </Link>
      {/* [Gate OpsCMS] 管理者だけ: 管理の画面・運用コンソール(開くと多要素認証の確認がある) */}
      {isAdmin && (
        <>
          <Link to="/admin" className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors" onClick={onClose}>
            <ShieldCheck size={16} className="inline mr-2" aria-hidden="true" />
            管理の画面
          </Link>
          <Link to="/admin/ops" className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors" onClick={onClose}>
            <Activity size={16} className="inline mr-2" aria-hidden="true" />
            運用コンソール(API・原価)
          </Link>
        </>
      )}
      <Link
        to="/search/settings"
        className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
        onClick={onClose}
      >
        <Brain size={16} className="inline mr-2" aria-hidden="true" />
        検索の設定
      </Link>
      {/* [Gate HeaderPicker] 見た目の切り替えは上の帯の印(ThemeToggle)へ移した */}
      <hr className="my-1 border-cloud-200" />
      <button
        onClick={() => {
          onClose();
          onLogout();
        }}
        className="block w-full text-left px-4 py-2 text-sm text-danger hover:bg-danger-soft transition-colors"
      >
        <LogOut size={16} className="inline mr-2" aria-hidden="true" />
        ログアウト
      </button>
    </div>
  );
};

export const MobileMenu: React.FC<{ pathname: string; tripId: string | null; onClose: () => void }> = ({ pathname, tripId, onClose }) => (
  <nav className="md:hidden border-t border-cloud-200 mobile-menu-container" aria-label="主なメニュー(スマホ)">
    <ul className="py-2 grid grid-cols-2 gap-1 px-2">
      {railItems(tripId, pathname).map(({ key, label, icon: Icon, to, match }) => (
        <li key={key}>
          <Link
            to={safeInternalPath(to) ?? '/dashboard'}
            aria-current={match(pathname) ? 'page' : undefined}
            className="tc-focus-ring flex items-center gap-3 px-3 py-3 text-base font-medium rounded-lg text-ink-700 hover:text-ink-900 hover:bg-cloud-100"
            onClick={onClose}
          >
            <Icon size={20} aria-hidden="true" />
            <span>{label}</span>
          </Link>
        </li>
      ))}
      <li>
        <Link to="/settings" onClick={onClose}
          className="tc-focus-ring flex items-center gap-3 px-3 py-3 text-base font-medium rounded-lg text-ink-700 hover:text-ink-900 hover:bg-cloud-100">
          <Settings size={20} aria-hidden="true" /><span>設定</span>
        </Link>
      </li>
    </ul>
  </nav>
);
