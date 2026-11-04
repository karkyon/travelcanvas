/**
 * [Gate MockFit] 知らせ(toast)1件の表示。最初に読む JS を小さく保つため、知らせが出た時に読み込む(Toast.tsx の lazy)。
 */
import React, { useState, useEffect } from 'react';
import type { Toast } from './toastContext';

interface ToastItemProps {
  toast: Toast;
  onClose: () => void;
}

const ToastItem: React.FC<ToastItemProps> = ({ toast, onClose }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // エントランスアニメーション
    setTimeout(() => setIsVisible(true), 50);
  }, []);

  const handleClose = () => {
    setIsExiting(true);
    setTimeout(() => {
      onClose();
    }, 200);
  };

  const typeStyles = {
    success: {
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
        </svg>
      ),
      colors: 'bg-success-soft border-success text-success',
      iconColor: 'text-success'
    },
    error: {
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
        </svg>
      ),
      colors: 'bg-danger-soft border-danger text-danger',
      iconColor: 'text-danger'
    },
    warning: {
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
      ),
      colors: 'bg-warning-soft border-warning text-warning',
      iconColor: 'text-warning'
    },
    info: {
      icon: (
        <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      ),
      colors: 'bg-info-soft border-info text-info',
      iconColor: 'text-info'
    }
  };

  const style = typeStyles[toast.type];

  return (
    <div
      className={`
        max-w-sm w-full border rounded-lg shadow-lg transform transition-all duration-200 ease-out
        ${style.colors}
        ${isVisible && !isExiting ? 'translate-x-0 opacity-100' : 'translate-x-full opacity-0'}
        ${isExiting ? 'scale-95' : 'scale-100'}
      `}
    >
      <div className="p-4">
        <div className="flex items-start">
          <div className={`shrink-0 ${style.iconColor}`}>
            {style.icon}
          </div>
          
          <div className="ml-3 flex-1">
            {toast.title && (
              <h4 className="text-sm font-medium mb-1">
                {toast.title}
              </h4>
            )}
            <p className="text-sm">
              {toast.message}
            </p>
            
            {toast.action && (
              <div className="mt-3">
                <button
                  className="text-sm font-medium underline hover:no-underline focus:outline-hidden"
                  onClick={toast.action.onClick}
                >
                  {toast.action.label}
                </button>
              </div>
            )}
          </div>
          
          {toast.closable && (
            <div className="ml-4 shrink-0">
              {/* [Gate G7] 名前の無いボタンだった(axe button-name。並べ替えの知らせが出たままの画面で検出) */}
              <button
                type="button"
                aria-label="知らせを閉じる"
                className="inline-flex text-ink-700 hover:text-ink-900 focus:outline-hidden focus:text-ink-900 transition-colors"
                onClick={handleClose}
              >
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                  <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToastItem;
