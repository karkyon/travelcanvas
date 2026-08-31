/**
 * Toast コンポーネント
 * 通知メッセージ表示
 */
import React from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'warning' | 'info';
  onClose?: () => void;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({ 
  message, 
  type, 
  onClose,
  className = ''
}) => {
  const bgColors = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    warning: 'bg-yellow-500',
    info: 'bg-blue-500'
  };
  
  const icons = {
    success: '✓',
    error: '✕',
    warning: '⚠',
    info: 'ℹ'
  };
  
  return (
    <div className={`fixed top-4 right-4 ${bgColors[type]} text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-2 z-50 ${className}`}>
      <span className="text-lg">{icons[type]}</span>
      <span>{message}</span>
      {onClose && (
        <button 
          onClick={onClose}
          className="ml-4 text-white hover:text-gray-200"
        >
          ✕
        </button>
      )}
    </div>
  );
};

export default Toast;
