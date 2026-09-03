import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { 
  Search, 
  Settings, 
  User, 
  Bell, 
  Menu, 
  X, 
  Home,
  Calendar,
  Zap,
  Brain,
  LogOut
} from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { notificationsAPI } from '../services/api';
import { toast } from 'react-hot-toast';

const Header: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, logout, isAuthenticated } = useAuthStore();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  // [Gate #26] 以前は実データと無関係な固定の未読バッジ(常時点滅)だった。
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    if (!isAuthenticated) {
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
  }, [isAuthenticated]);

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
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* ロゴのみ */}
            <div className="flex items-center">
              <Link to="/login" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">TC</span>
                </div>
                <span className="text-xl font-bold text-gray-900">
                  TravelCanvas
                </span>
              </Link>
            </div>

            {/* ログイン・登録ボタン */}
            <div className="flex items-center space-x-3">
              <Link
                to="/login"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg transition-colors"
              >
                ログイン
              </Link>
              <Link
                to="/register"
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
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
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* ロゴ */}
            <div className="flex items-center">
              <Link to="/login" className="flex items-center space-x-2">
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                  <span className="text-white font-bold text-sm">TC</span>
                </div>
                <span className="text-xl font-bold text-gray-900">
                  TravelCanvas
                </span>
              </Link>
            </div>

            {/* ログイン・登録ボタン */}
            <div className="flex items-center space-x-3">
              <Link
                to="/login"
                className="text-gray-600 hover:text-gray-900 px-3 py-2 rounded-lg transition-colors"
              >
                ログイン
              </Link>
              <Link
                to="/register"
                className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200"
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
  return (
    <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          {/* ロゴ */}
          <div className="flex items-center">
            <Link to="/dashboard" className="flex items-center space-x-2">
              <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg flex items-center justify-center">
                <span className="text-white font-bold text-sm">TC</span>
              </div>
              <span className="text-xl font-bold text-gray-900 hidden sm:block">
                TravelCanvas
              </span>
            </Link>
          </div>

          {/* デスクトップナビゲーション */}
          <nav className="hidden md:flex space-x-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = isActivePath(item.path);
              
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`relative px-4 py-2 rounded-lg transition-colors duration-200 flex items-center space-x-2 group ${
                    isActive
                      ? 'bg-blue-100 text-blue-700'
                      : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                  }`}
                  title={item.description}
                >
                  <Icon size={18} />
                  <span className="font-medium">{item.name}</span>
                  
                  {/* NEW バッジ */}
                  {item.isNew && (
                    <span className="absolute -top-1 -right-1 bg-gradient-to-r from-green-400 to-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                      NEW
                    </span>
                  )}
                  
                  {/* AI検索の場合の特別なアイコン */}
                  {item.path === '/search' && (
                    <Zap size={14} className="text-yellow-500 animate-pulse" />
                  )}
                </Link>
              );
            })}
          </nav>

          {/* AI検索クイックアクセス（デスクトップ） */}
          <div className="hidden lg:flex items-center space-x-3">
            <Link
              to="/search/settings"
              className="p-2 text-gray-500 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
              title="AI検索設定"
            >
              <Settings size={18} />
            </Link>
            
            {/* クイック検索ボタン */}
            <Link
              to="/search"
              className="bg-gradient-to-r from-blue-500 to-purple-600 text-white px-4 py-2 rounded-lg hover:from-blue-600 hover:to-purple-700 transition-all duration-200 flex items-center space-x-2 shadow-sm hover:shadow-md transform hover:scale-105"
            >
              <Search size={16} />
              <span className="font-medium">AI検索</span>
              <Zap size={14} className="animate-pulse" />
            </Link>
          </div>

          {/* 右側メニュー */}
          <div className="flex items-center space-x-3">
            {/* 通知 */}
            <Link
              to="/notifications"
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors relative"
              title="通知"
            >
              <Bell size={18} />
              {unreadCount > 0 && (
                <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 flex items-center justify-center text-[10px] font-medium bg-red-500 text-white rounded-full">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </Link>

            {/* ユーザーメニュー */}
            <div className="relative user-menu-container">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setIsUserMenuOpen(!isUserMenuOpen);
                }}
                className="flex items-center space-x-2 p-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-full flex items-center justify-center">
                  <User size={16} className="text-white" />
                </div>
                <span className="hidden sm:block font-medium">
                  {user?.username || 'ユーザー'}
                </span>
              </button>

              {/* ユーザードロップダウン */}
              {isUserMenuOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-10 animate-in slide-in-from-top-1 duration-200">
                  <div className="px-4 py-2 border-b border-gray-100">
                    <p className="text-sm font-medium text-gray-900">
                      {user?.username}
                    </p>
                    <p className="text-xs text-gray-500">
                      {user?.email}
                    </p>
                  </div>
                  
                  <Link
                    to="/profile"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <User size={16} className="inline mr-2" />
                    プロフィール
                  </Link>
                  <Link
                    to="/settings"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Settings size={16} className="inline mr-2" />
                    設定
                  </Link>
                  <Link
                    to="/search/settings"
                    className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
                    onClick={() => setIsUserMenuOpen(false)}
                  >
                    <Brain size={16} className="inline mr-2" />
                    AI検索設定
                    <span className="ml-2 bg-gradient-to-r from-green-400 to-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                      NEW
                    </span>
                  </Link>
                  <hr className="my-1" />
                  <button
                    onClick={() => {
                      setIsUserMenuOpen(false);
                      handleLogout();
                    }}
                    className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut size={16} className="inline mr-2" />
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
              className="md:hidden p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors"
            >
              {isMobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </div>

        {/* モバイルメニュー */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 bg-white mobile-menu-container animate-in slide-in-from-top-2 duration-200">
            <div className="py-2 space-y-1">
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive = isActivePath(item.path);
                
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className={`relative flex items-center space-x-3 px-4 py-3 text-base font-medium rounded-lg mx-2 transition-colors ${
                      isActive
                        ? 'bg-blue-100 text-blue-700'
                        : 'text-gray-600 hover:text-gray-900 hover:bg-gray-100'
                    }`}
                    onClick={() => setIsMobileMenuOpen(false)}
                  >
                    <Icon size={20} />
                    <span>{item.name}</span>
                    
                    {/* AI検索の特別表示 */}
                    {item.path === '/search' && (
                      <div className="flex items-center space-x-1">
                        <Zap size={16} className="text-yellow-500 animate-pulse" />
                        {item.isNew && (
                          <span className="bg-gradient-to-r from-green-400 to-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full animate-pulse">
                            NEW
                          </span>
                        )}
                      </div>
                    )}
                  </Link>
                );
              })}
              
              {/* モバイル専用クイックアクション */}
              <div className="px-2 pt-2 border-t border-gray-200">
                <Link
                  to="/search"
                  className="flex items-center space-x-3 px-4 py-3 text-base font-medium bg-gradient-to-r from-blue-500 to-purple-600 text-white rounded-lg mb-2 hover:from-blue-600 hover:to-purple-700 transition-all"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Search size={20} />
                  <span>AI検索を開始</span>
                  <Zap size={16} className="animate-pulse" />
                </Link>
                
                <Link
                  to="/search/settings"
                  className="flex items-center space-x-3 px-4 py-3 text-base font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg"
                  onClick={() => setIsMobileMenuOpen(false)}
                >
                  <Settings size={20} />
                  <span>AI検索設定</span>
                  <span className="ml-auto bg-gradient-to-r from-green-400 to-blue-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    NEW
                  </span>
                </Link>
              </div>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default Header;