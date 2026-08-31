import { RouterProvider } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { router } from './router'
import ErrorBoundary from './components/common/ErrorBoundary'
import { useEffect } from 'react'

// React Query クライアント設定
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 3,
      staleTime: 1000 * 60 * 5, // 5分
      cacheTime: 1000 * 60 * 30, // 30分
      refetchOnWindowFocus: false,
    },
    mutations: {
      retry: 1,
    },
  },
})

function App() {
  // PWA インストールプロンプト管理
  useEffect(() => {
    let deferredPrompt: any = null

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault()
      deferredPrompt = e
      
      // カスタムインストールボタンを表示する場合
      // showInstallPromotion()
    }

    const handleAppInstalled = () => {
      console.log('PWA がインストールされました')
      deferredPrompt = null
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  // 開発環境でのパフォーマンス監視
  useEffect(() => {
    if (import.meta.env.DEV && 'performance' in window) {
      // Largest Contentful Paint (LCP) 測定
      const observer = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries()
        const lastEntry = entries[entries.length - 1]
        console.log('LCP:', lastEntry.startTime)
      })
      
      observer.observe({ entryTypes: ['largest-contentful-paint'] })
      
      return () => observer.disconnect()
    }
  }, [])

  return (
    <QueryClientProvider client={queryClient}>
      <ErrorBoundary>
        <div className="min-h-screen bg-gray-50">
          <RouterProvider router={router} />
        </div>
        
        {/* React Query DevTools (開発環境のみ) */}
        {import.meta.env.DEV && (
          <ReactQueryDevtools 
            initialIsOpen={false}
            position="bottom-right"
          />
        )}
      </ErrorBoundary>
    </QueryClientProvider>
  )
}

export default App