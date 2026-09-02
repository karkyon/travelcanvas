import React, { useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import Header from './Header'
import Sidebar from './Sidebar'

interface MainLayoutProps {
  children: React.ReactNode
  showSidebar?: boolean
  sidebarContent?: React.ReactNode
}

const MainLayout: React.FC<MainLayoutProps> = ({ 
  children, 
  showSidebar = false,
  sidebarContent 
}) => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const { user } = useAuth()

  const toggleSidebar = () => {
    setIsSidebarOpen(!isSidebarOpen)
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ヘッダー */}
      <Header 
        onMenuClick={showSidebar ? toggleSidebar : undefined}
        user={user}
      />

      <div className="flex">
        {/* サイドバー（必要な場合のみ） */}
        {showSidebar && (
          <Sidebar 
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
            content={sidebarContent}
          />
        )}

        {/* メインコンテンツ */}
        <main className={`
          flex-1 
          transition-all duration-300 ease-in-out
          ${showSidebar && isSidebarOpen ? 'lg:ml-64' : ''}
          ${showSidebar ? 'lg:ml-0' : ''}
        `}>
          <div className="container mx-auto px-4 py-6">
            {children}
          </div>
        </main>
      </div>

      {/* サイドバーオーバーレイ（モバイル） */}
      {showSidebar && isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 z-40 lg:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}
    </div>
  )
}

export default MainLayout