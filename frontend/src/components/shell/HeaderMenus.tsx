/**
 * [Gate AppShell] 上の帯のメニュー(利用者のメニュー・スマホのメニュー)。開いた時に読み込む別の塊。
 * 中身は以前の Header と同じ(プロフィール・組織・設定・検索の設定・見た目・ログアウト)。
 */
import React from 'react';
import { Link } from 'react-router-dom';
import { Settings, User, Brain, LogOut, Building2 } from 'lucide-react';
import { useAuthStore } from '../../store/authStore';
import { useThemePreference, type ThemePreference } from '../../hooks/useThemePreference';
import { railItems } from './railItems';

const THEME_CHOICES: Array<{ value: ThemePreference; label: string }> = [
  { value: 'light', label: '明るい' },
  { value: 'dark', label: '暗い' },
  { value: 'system', label: '端末' },
];

export const UserMenu: React.FC<{ onClose: () => void; onLogout: () => void }> = ({ onClose, onLogout }) => {
  const { user, isGuest } = useAuthStore();
  const { preference: themePreference, setPreference: setThemePreference } = useThemePreference();
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
      <Link
        to="/search/settings"
        className="block px-4 py-2 text-sm text-ink-700 hover:bg-cloud-100 transition-colors"
        onClick={onClose}
      >
        <Brain size={16} className="inline mr-2" aria-hidden="true" />
        検索の設定
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
            to={to}
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
