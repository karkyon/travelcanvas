import React, { Suspense, lazy, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
// [Gate M9-FE-B2] Context・useToast Hook・型はtoastContext.tsへ移設
// (Fast Refresh: コンポーネントと非コンポーネントのexport混在を解消)。
import { ToastContext, type Toast, type ToastPosition } from './toastContext';

// [Gate MockFit] 表示部品は知らせが出た時に読む(最初に読む JS の上限 430 kB のため)
// 通信できない間(オフライン)に初めて知らせが出ても落ちないよう、起動直後に先読みし、読めなかった時は簡素な表示にする
const loadToastItem = () => import('./ToastItem');
const ToastItem = lazy(() => loadToastItem().catch(() => ({
  default: ({ toast, onClose }: { toast: Toast; onClose: () => void }) => (
    <div role="status" className="max-w-sm w-full border rounded-lg shadow-lg bg-surface p-4 text-sm">
      {toast.title ? <strong className="block mb-1">{toast.title}</strong> : null}
      <span>{toast.message}</span>
      <button type="button" aria-label="知らせを閉じる" className="ml-3 underline" onClick={onClose}>閉じる</button>
    </div>
  ),
})));

interface ToastProviderProps {
  position?: ToastPosition;
  maxToasts?: number;
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({
  position = 'top-right',
  maxToasts = 5,
  children
}) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  useEffect(() => {
    void loadToastItem().catch(() => undefined);
  }, []);

  // [Gate M9-FE-B3] addToast/removeToast/clearToastsとcontext valueを安定化する。
  // 以前は描画のたびに関数・value objectが作り直されていたため、利用側で
  // addToastをeffect/useCallbackの依存に含めると、toast表示(=Provider再描画)の
  // たびに依存が変化し、「読み込み失敗→エラーtoast→再読み込み→…」の無限ループを
  // 起こし得た(そのため利用側は依存から外さざるを得ず、exhaustive-deps警告の
  // 原因になっていた)。挙動(toastの追加・自動削除・最大件数)は変更しない。
  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(toast => toast.id !== id));
  }, []);

  const addToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newToast: Toast = {
      id,
      duration: 5000,
      closable: true,
      ...toast
    };

    setToasts(prev => {
      const updated = [newToast, ...prev];
      return updated.slice(0, maxToasts);
    });

    // 自動削除
    if (newToast.duration && newToast.duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, newToast.duration);
    }
  }, [maxToasts, removeToast]);

  const clearToasts = useCallback(() => {
    setToasts([]);
  }, []);

  const contextValue = useMemo(
    () => ({ addToast, removeToast, clearToasts }),
    [addToast, removeToast, clearToasts]
  );

  const positionClasses = {
    'top-right': 'top-4 right-4',
    'top-left': 'top-4 left-4',
    'bottom-right': 'bottom-4 right-4',
    'bottom-left': 'bottom-4 left-4',
    'top-center': 'top-4 left-1/2 transform -translate-x-1/2',
    'bottom-center': 'bottom-4 left-1/2 transform -translate-x-1/2'
  };

  return (
    <ToastContext.Provider value={contextValue}>
      {children}
      {toasts.length > 0 && createPortal(
        <Suspense fallback={null}><div className={`fixed z-50 space-y-3 ${positionClasses[position]}`}>
          {toasts.map(toast => (
            <ToastItem
              key={toast.id}
              toast={toast}
              onClose={() => removeToast(toast.id)}
            />
          ))}
        </div></Suspense>,
        document.body
      )}
    </ToastContext.Provider>
  );
};
