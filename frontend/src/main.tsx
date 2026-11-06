import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { ToastProvider } from './components/common/Toast'
import './index.css'

// [Gate HeaderPicker] 起動の度に環境変数(API の送り先)を console へ出す調べ物の残りを外した(最初に読む JS も減る)

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