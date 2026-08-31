import React from 'react'

interface SidebarProps {
  isOpen: boolean
  onClose: () => void
  content?: React.ReactNode
  width?: 'sm' | 'md' | 'lg'
}

const Sidebar: React.FC<SidebarProps> = ({ 
  isOpen, 
  onClose, 
  content,
  width = 'md'
}) => {
  const widthClasses = {
    sm: 'w-48',
    md: 'w-64', 
    lg: 'w-80'
  }

  return (
    <>
      {/* デスクトップサイドバー */}
      <div className={`
        hidden lg:flex lg:flex-shrink-0 transition-all duration-300 ease-in-out
        ${isOpen ? 'lg:w-64' : 'lg:w-0'}
      `}>
        <div className={`
          flex flex-col ${widthClasses[width]} bg-white border-r border-gray-200
          ${isOpen ? 'opacity-100' : 'opacity-0 overflow-hidden'}
          transition-opacity duration-300
        `}>
          {/* サイドバーヘッダー */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">メニュー</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* サイドバーコンテンツ */}
          <div className="flex-1 overflow-y-auto">
            {content}
          </div>
        </div>
      </div>

      {/* モバイルサイドバー */}
      <div className={`
        fixed inset-0 z-50 lg:hidden transition-opacity duration-300
        ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}
      `}>
        {/* オーバーレイ */}
        <div 
          className="absolute inset-0 bg-black bg-opacity-50"
          onClick={onClose}
        />

        {/* サイドバーパネル */}
        <div className={`
          absolute left-0 top-0 h-full ${widthClasses[width]} bg-white shadow-xl
          transform transition-transform duration-300 ease-in-out
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}>
          {/* サイドバーヘッダー */}
          <div className="flex items-center justify-between p-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">メニュー</h2>
            <button
              onClick={onClose}
              className="p-1 rounded-md text-gray-400 hover:text-gray-500 hover:bg-gray-100"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* サイドバーコンテンツ */}
          <div className="flex-1 overflow-y-auto">
            {content}
          </div>
        </div>
      </div>
    </>
  )
}

export default Sidebar