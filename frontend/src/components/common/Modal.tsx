import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import Button from './Button';

type ModalSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  size?: ModalSize;
  closable?: boolean;
  maskClosable?: boolean;
  showCloseButton?: boolean;
  className?: string;
  children: React.ReactNode;
}

interface ModalHeaderProps {
  title?: string;
  onClose?: () => void;
  showCloseButton?: boolean;
  children?: React.ReactNode;
}

interface ModalBodyProps {
  className?: string;
  children: React.ReactNode;
}

interface ModalFooterProps {
  className?: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> & {
  Header: React.FC<ModalHeaderProps>;
  Body: React.FC<ModalBodyProps>;
  Footer: React.FC<ModalFooterProps>;
} = ({
  isOpen,
  onClose,
  title,
  size = 'md',
  closable = true,
  maskClosable = true,
  showCloseButton = true,
  className = '',
  children
}) => {
  const modalRef = useRef<HTMLDivElement>(null);
  const previousActiveElement = useRef<HTMLElement | null>(null);

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-full mx-4 my-4 h-[calc(100vh-2rem)]'
  };

  // ESC キーでモーダルを閉じる
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && closable) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      // フォーカストラップのため、現在のアクティブ要素を保存
      previousActiveElement.current = document.activeElement as HTMLElement;
      
      // モーダルにフォーカスを移動
      setTimeout(() => {
        modalRef.current?.focus();
      }, 0);
      
      // ページスクロールを無効化
      document.body.style.overflow = 'hidden';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      // ページスクロールを復元
      document.body.style.overflow = 'unset';
      
      // 元のアクティブ要素にフォーカスを戻す
      if (previousActiveElement.current) {
        previousActiveElement.current.focus();
      }
    };
  }, [isOpen, closable, onClose]);

  // マスククリックでモーダルを閉じる
  const handleMaskClick = (event: React.MouseEvent) => {
    if (event.target === event.currentTarget && maskClosable && closable) {
      onClose();
    }
  };

  // フォーカストラップ
  const handleKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Tab') {
      const focusableElements = modalRef.current?.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      
      if (focusableElements && focusableElements.length > 0) {
        const firstElement = focusableElements[0] as HTMLElement;
        const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;
        
        if (event.shiftKey) {
          if (document.activeElement === firstElement) {
            event.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            event.preventDefault();
            firstElement.focus();
          }
        }
      }
    }
  };

  if (!isOpen) return null;

  const modalContent = (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto"
      aria-labelledby="modal-title"
      role="dialog"
      aria-modal="true"
    >
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={handleMaskClick}
      />
      
      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          ref={modalRef}
          className={`
            relative transform transition-all w-full
            ${sizeClasses[size]}
            bg-white rounded-xl shadow-2xl
            ${size === 'full' ? 'flex flex-col' : ''}
            ${className}
          `}
          onKeyDown={handleKeyDown}
          tabIndex={-1}
        >
          {/* Default Header */}
          {title && (
            <Modal.Header 
              title={title} 
              onClose={closable ? onClose : undefined}
              showCloseButton={showCloseButton}
            />
          )}
          
          {/* Content */}
          {children}
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

// Modal Header Component
const ModalHeader: React.FC<ModalHeaderProps> = ({
  title,
  onClose,
  showCloseButton = true,
  children
}) => {
  if (children) {
    return (
      <div className="flex items-center justify-between p-6 border-b border-gray-200">
        {children}
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between p-6 border-b border-gray-200">
      <h2 id="modal-title" className="text-xl font-semibold text-gray-900">
        {title}
      </h2>
      {showCloseButton && onClose && (
        <Button
          variant="ghost"
          size="sm"
          onClick={onClose}
          className="p-2 -mr-2"
          aria-label="モーダルを閉じる"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </Button>
      )}
    </div>
  );
};

// Modal Body Component
const ModalBody: React.FC<ModalBodyProps> = ({
  className = '',
  children
}) => {
  return (
    <div className={`p-6 flex-1 overflow-y-auto ${className}`}>
      {children}
    </div>
  );
};

// Modal Footer Component
const ModalFooter: React.FC<ModalFooterProps> = ({
  className = '',
  children
}) => {
  return (
    <div className={`flex items-center justify-end gap-3 p-6 border-t border-gray-200 ${className}`}>
      {children}
    </div>
  );
};

// Attach sub-components
Modal.Header = ModalHeader;
Modal.Body = ModalBody;
Modal.Footer = ModalFooter;

export default Modal;