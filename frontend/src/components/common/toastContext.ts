/**
 * Toast Context・useToast Hook・関連型
 *
 * [Gate M9-FE-B2] 以前はToast.tsx(ToastProvider/ToastItemコンポーネント)内に
 * 同居していたが、Vite Fast Refresh(eslint react-refresh/only-export-components)
 * のため非コンポーネントのexportをこのファイルへ移設した。ロジックは変更していない。
 *
 * 注意: src/hooks/useToast.ts(react-hot-toastラッパー)とは別物。
 * こちらはToastProvider(main.tsxでマウント)配下で使うContext版。
 */

import { createContext, useContext } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';
export type ToastPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center' | 'bottom-center';

export interface Toast {
  id: string;
  type: ToastType;
  title?: string;
  message: string;
  duration?: number;
  closable?: boolean;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export interface ToastContextType {
  addToast: (toast: Omit<Toast, 'id'>) => void;
  removeToast: (id: string) => void;
  clearToasts: () => void;
}

export const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
