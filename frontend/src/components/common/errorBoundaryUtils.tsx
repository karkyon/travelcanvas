/**
 * ErrorBoundary関連ユーティリティ(HOC・Hook)
 *
 * [Gate M9-FE-B2] 以前はErrorBoundary.tsx内に同居していたが、コンポーネント以外の
 * exportが混在するとVite Fast Refreshがファイル単位の更新を行えないため
 * (eslint react-refresh/only-export-components)、定義を移設のみ行った。
 * ロジックは変更していない。
 */

import React from 'react';
import ErrorBoundary, { type ErrorBoundaryProps } from './ErrorBoundary';

/**
 * withErrorBoundary HOC - コンポーネントをエラーバウンダリでラップ
 */
export function withErrorBoundary<P extends object>(
  Component: React.ComponentType<P>,
  errorBoundaryProps?: Omit<ErrorBoundaryProps, 'children'>
) {
  const WrappedComponent = (props: P) => (
    <ErrorBoundary {...errorBoundaryProps}>
      <Component {...props} />
    </ErrorBoundary>
  );

  WrappedComponent.displayName = `withErrorBoundary(${Component.displayName || Component.name})`;

  return WrappedComponent;
}

/**
 * useErrorHandler Hook - 手動でエラーをエラーバウンダリに送信
 */
export function useErrorHandler() {
  return React.useCallback((error: Error, _errorInfo?: unknown) => {
    void _errorInfo;
    // エラーをthrowしてエラーバウンダリに捕捉させる
    setTimeout(() => {
      throw error;
    });
  }, []);
}
