import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ToastProvider } from './components/common/Toast'
import './index.css'

// 環境変数デバッグ
console.log('=== 環境変数確認 ===');
console.log('VITE_API_URL:', import.meta.env.VITE_API_URL);
console.log('VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL);
console.log('NODE_ENV:', import.meta.env.NODE_ENV);
console.log('===================');

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* [Gate #7j] useToast()を呼ぶコンポーネント(DayView/SharePage等)が
        "useToast must be used within a ToastProvider" で実行時クラッシュしていた実害バグ。
        ToastProviderがアプリ全体のどこにもマウントされていなかったため、ルートで追加。 */}
    <ToastProvider>
      <App />
    </ToastProvider>
  </React.StrictMode>,
)