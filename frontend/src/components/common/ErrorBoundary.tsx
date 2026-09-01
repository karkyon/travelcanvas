/**
 * ErrorBoundary - React エラーバウンダリコンポーネント
 * アプリケーション全体のエラーキャッチとフォールバックUI表示
 */

import React, { Component, ReactNode } from 'react';
import Button from './Button';
import Card from './Card';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
  errorId: string;
}

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void;
  showErrorDetails?: boolean;
}

interface ErrorDetails {
  message: string;
  stack?: string;
  componentStack?: string;
  timestamp: string;
  userAgent: string;
  url: string;
  userId?: string;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    // エラーIDを生成
    const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    return {
      hasError: true,
      error,
      errorId
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // エラー情報を保存
    this.setState({
      error,
      errorInfo
    });

    // エラーログを送信
    this.logError(error, errorInfo);

    // カスタムエラーハンドラーを呼び出し
    if (this.props.onError) {
      this.props.onError(error, errorInfo);
    }
  }

  /**
   * エラーログを送信
   */
  private logError = async (error: Error, errorInfo: React.ErrorInfo) => {
    const errorDetails: ErrorDetails = {
      message: error.message,
      stack: error.stack,
      componentStack: errorInfo.componentStack,
      timestamp: new Date().toISOString(),
      userAgent: navigator.userAgent,
      url: window.location.href,
      userId: this.getUserId()
    };

    try {
      // エラーログAPIに送信
      await fetch('/api/v1/errors/log', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          errorId: this.state.errorId,
          type: 'react_error',
          details: errorDetails,
          severity: 'error',
          context: {
            pathname: window.location.pathname,
            search: window.location.search,
            referrer: document.referrer
          }
        })
      });

      // ローカルストレージにも保存（オフライン対応）
      this.saveErrorToLocalStorage(errorDetails);

    } catch (logError) {
      console.error('Failed to log error:', logError);
      // ローカルストレージに保存
      this.saveErrorToLocalStorage(errorDetails);
    }
  };

  /**
   * ローカルストレージにエラーを保存
   */
  private saveErrorToLocalStorage = (errorDetails: ErrorDetails) => {
    try {
      const errors = JSON.parse(localStorage.getItem('travelcanvas_errors') || '[]');
      errors.push({
        id: this.state.errorId,
        ...errorDetails
      });
      
      // 最新の10件のみ保存
      const recentErrors = errors.slice(-10);
      localStorage.setItem('travelcanvas_errors', JSON.stringify(recentErrors));
    } catch (storageError) {
      console.error('Failed to save error to localStorage:', storageError);
    }
  };

  /**
   * ユーザーIDを取得
   */
  private getUserId = (): string | undefined => {
    try {
      const authData = localStorage.getItem('travelcanvas_auth');
      if (authData) {
        const parsed = JSON.parse(authData);
        return parsed.user?.id;
      }
    } catch {
      // エラーの場合は無視
    }
    return undefined;
  };

  /**
   * 認証トークンを取得
   */
  private getAuthToken = (): string | undefined => {
    try {
      const authData = localStorage.getItem('travelcanvas_auth');
      if (authData) {
        const parsed = JSON.parse(authData);
        return parsed.token?.access_token;
      }
    } catch {
      // エラーの場合は無視
    }
    return undefined;
  };

  /**
   * エラー状態をリセット
   */
  private handleReset = () => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      errorId: ''
    });
  };

  /**
   * ページをリロード
   */
  private handleReload = () => {
    window.location.reload();
  };

  /**
   * ホームページに移動
   */
  private handleGoHome = () => {
    window.location.href = '/';
  };

  /**
   * エラーレポートを送信
   */
  private handleSendReport = async () => {
    const { error, errorInfo, errorId } = this.state;
    
    if (!error) return;

    try {
      const userDescription = prompt('エラーが発生した際の操作内容を教えてください（任意）:');
      
      await fetch('/api/v1/errors/report', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify({
          errorId,
          userDescription,
          reproduceSteps: '',
          expectedBehavior: '',
          actualBehavior: error.message
        })
      });

      alert('エラーレポートを送信しました。ありがとうございます。');
    } catch (reportError) {
      console.error('Failed to send error report:', reportError);
      alert('エラーレポートの送信に失敗しました。');
    }
  };

  render() {
    const { hasError, error, errorInfo, errorId } = this.state;
    const { children, fallback, showErrorDetails = false } = this.props;

    if (hasError) {
      // カスタムフォールバックUIがある場合
      if (fallback) {
        return fallback;
      }

      // デフォルトエラーUI
      return (
        <div className="min-h-screen bg-gradient-to-br from-red-50 to-red-100 flex items-center justify-center p-4">
          <Card className="max-w-2xl w-full p-8 text-center">
            <div className="mb-6">
              <div className="text-6xl mb-4">🚨</div>
              <h1 className="text-3xl font-bold text-gray-900 mb-2">
                予期しないエラーが発生しました
              </h1>
              <p className="text-gray-600 mb-4">
                申し訳ありません。アプリケーションでエラーが発生しました。<br />
                以下の方法で問題を解決できる可能性があります。
              </p>
              <p className="text-sm text-gray-500">
                エラーID: <code className="bg-gray-100 px-2 py-1 rounded">{errorId}</code>
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <Button
                onClick={this.handleReset}
                variant="primary"
                className="w-full"
              >
                🔄 再試行
              </Button>
              <Button
                onClick={this.handleReload}
                variant="secondary"
                className="w-full"
              >
                🔃 ページ更新
              </Button>
              <Button
                onClick={this.handleGoHome}
                variant="outline"
                className="w-full"
              >
                🏠 ホームに戻る
              </Button>
            </div>

            <div className="mb-6">
              <Button
                onClick={this.handleSendReport}
                variant="ghost"
                className="text-sm"
              >
                📤 エラーレポートを送信
              </Button>
            </div>

            {/* エラー詳細の表示（開発時またはオプション） */}
            {(showErrorDetails || process.env.NODE_ENV === 'development') && error && (
              <details className="text-left bg-gray-50 p-4 rounded-lg mt-6">
                <summary className="cursor-pointer font-semibold text-gray-700 mb-2">
                  🔧 エラー詳細（技術者向け）
                </summary>
                <div className="space-y-4">
                  <div>
                    <h4 className="font-medium text-gray-800">エラーメッセージ:</h4>
                    <pre className="bg-white p-2 rounded text-sm text-red-600 overflow-auto">
                      {error.message}
                    </pre>
                  </div>
                  
                  {error.stack && (
                    <div>
                      <h4 className="font-medium text-gray-800">スタックトレース:</h4>
                      <pre className="bg-white p-2 rounded text-xs text-gray-600 overflow-auto max-h-40">
                        {error.stack}
                      </pre>
                    </div>
                  )}
                  
                  {errorInfo?.componentStack && (
                    <div>
                      <h4 className="font-medium text-gray-800">コンポーネントスタック:</h4>
                      <pre className="bg-white p-2 rounded text-xs text-gray-600 overflow-auto max-h-40">
                        {errorInfo.componentStack}
                      </pre>
                    </div>
                  )}

                  <div>
                    <h4 className="font-medium text-gray-800">環境情報:</h4>
                    <ul className="text-sm text-gray-600 space-y-1">
                      <li>URL: {window.location.href}</li>
                      <li>User Agent: {navigator.userAgent}</li>
                      <li>Timestamp: {new Date().toISOString()}</li>
                    </ul>
                  </div>
                </div>
              </details>
            )}

            <div className="mt-6 text-xs text-gray-500">
              <p>
                問題が継続する場合は、
                <a href="mailto:support@travelcanvas.app" className="text-blue-600 hover:underline">
                  サポートチーム
                </a>
                までお問い合わせください。
              </p>
            </div>
          </Card>
        </div>
      );
    }

    return children;
  }
}

export default ErrorBoundary;

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
  return React.useCallback((error: Error, errorInfo?: any) => {
    // エラーをthrowしてエラーバウンダリに捕捉させる
    setTimeout(() => {
      throw error;
    });
  }, []);
}