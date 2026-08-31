import React, { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import Button from '../Button'
import Modal from '../Modal'

interface HeaderProps {
  onMenuClick?: () => void
  user?: any
}

const Header: React.FC<HeaderProps> = ({ onMenuClick, user }) => {
  const navigate = useNavigate()
  const { logout } = useAuth()
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false)
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false)

  const handleLogout = async () => {
    try {
      await logout()
      navigate('/')
    } catch (error) {
      console.error('ログアウトに失敗しました:', error)
    }
    setIsLogoutModalOpen(false)
  }

  const navigationItems = [
    { name: 'ホーム', href: '/', icon: '🏠' },
    { name: '新規作成', href: '/planner', icon: '📝' },
    { name: '共有', href: '/share', icon: '🤝' },
  ]

  return (
    <>
      <header className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            {/* 左側: ロゴとナビゲーション */}
            <div className="flex items-center space-x-8">
              {/* メニューボタン（モバイル/サイドバー用） */}
              {onMenuClick && (
                <button
                  onClick={onMenuClick}
                  className="lg:hidden p-2 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
                >
                  <span className="sr-only">メニューを開く</span>
                  <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                  </svg>
                </button>
              )}

              {/* ロゴ */}
              <Link to="/" className="flex items-center space-x-2">
                <span className="text-2xl">🎨</span>
                <span className="text-xl font-bold text-gray-900">TravelCanvas</span>
              </Link>

              {/* デスクトップナビゲーション */}
              <nav className="hidden md:flex space-x-6">
                {navigationItems.map((item) => (
                  <Link
                    key={item.name}
                    to={item.href}
                    className="flex items-center space-x-1 text-gray-600 hover:text-blue-600 transition-colors duration-200"
                  >
                    <span>{item.icon}</span>
                    <span className="font-medium">{item.name}</span>
                  </Link>
                ))}
              </nav>
            </div>

            {/* 右側: ユーザーメニューまたはログイン */}
            <div className="flex items-center space-x-4">
              {user ? (
                /* ログイン済みユーザーメニュー */
                <div className="relative">
                  <button
                    onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                    className="flex items-center space-x-2 p-2 rounded-md text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors duration-200"
                  >
                    <div className="w-8 h-8 bg-blue-500 rounded-full flex items-center justify-center text-white text-sm font-medium">
                      {user.full_name ? user.full_name.charAt(0).toUpperCase() : user.username?.charAt(0).toUpperCase() || 'G'}
                    </div>
                    <span className="hidden md:block font-medium">
                      {user.full_name || user.username || 'ゲスト'}
                    </span>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* ドロップダウンメニュー */}
                  {isUserMenuOpen && (
                    <div className="absolute right-0 mt-2 w-48 bg-white rounded-md shadow-lg py-1 z-50 border border-gray-200">
                      <Link
                        to="/dashboard"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        📊 ダッシュボード
                      </Link>
                      <Link
                        to="/settings"
                        className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                        onClick={() => setIsUserMenuOpen(false)}
                      >
                        ⚙️ 設定
                      </Link>
                      {user.user_type === 'admin' && (
                        <Link
                          to="/admin"
                          className="block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                          onClick={() => setIsUserMenuOpen(false)}
                        >
                          👑 管理画面
                        </Link>
                      )}
                      <div className="border-t border-gray-100"></div>
                      <button
                        onClick={() => {
                          setIsUserMenuOpen(false)
                          setIsLogoutModalOpen(true)
                        }}
                        className="block w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                      >
                        🚪 ログアウト
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* 未ログインユーザー */
                <div className="flex items-center space-x-3">
                  <Link to="/login">
                    <Button variant="outline" size="sm">
                      ログイン
                    </Button>
                  </Link>
                  <Link to="/register">
                    <Button variant="primary" size="sm">
                      会員登録
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* モバイルナビゲーション */}
        <div className="md:hidden border-t border-gray-200 bg-gray-50">
          <nav className="px-4 py-2 space-y-1">
            {navigationItems.map((item) => (
              <Link
                key={item.name}
                to={item.href}
                className="flex items-center space-x-2 p-2 rounded-md text-gray-600 hover:text-blue-600 hover:bg-white transition-colors duration-200"
              >
                <span>{item.icon}</span>
                <span className="font-medium">{item.name}</span>
              </Link>
            ))}
          </nav>
        </div>
      </header>

      {/* ログアウト確認モーダル */}
      <Modal
        isOpen={isLogoutModalOpen}
        onClose={() => setIsLogoutModalOpen(false)}
        title="ログアウト確認"
      >
        <div className="space-y-4">
          <p className="text-gray-600">
            本当にログアウトしますか？未保存の変更は失われる可能性があります。
          </p>
          <div className="flex space-x-3 justify-end">
            <Button
              variant="outline"
              onClick={() => setIsLogoutModalOpen(false)}
            >
              キャンセル
            </Button>
            <Button
              variant="danger"
              onClick={handleLogout}
            >
              ログアウト
            </Button>
          </div>
        </div>
      </Modal>

      {/* 外側クリックでメニューを閉じる */}
      {isUserMenuOpen && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setIsUserMenuOpen(false)}
        />
      )}
    </>
  )
}

export default Header