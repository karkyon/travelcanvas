/**
 * [Gate M9-FE-B3] ToastProviderが公開する関数・context valueの参照安定性。
 *
 * 以前はProviderの描画ごとにaddToast等が作り直されていたため、利用側で
 * addToastをeffect/useCallbackの依存に含めると「toast表示→Provider再描画→
 * addToast変化→effect再実行→(失敗時)再度toast…」という無限ループを起こし得た。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ToastProvider } from './Toast';
import { useToast } from './toastContext';

type ToastApi = ReturnType<typeof useToast>;

describe('ToastProvider (Gate M9-FE-B3)', () => {
  it('toastを表示してProviderが再描画されても、addToast/removeToast/clearToastsの参照は変わらない', () => {
    const seen: ToastApi[] = [];
    const Probe = () => {
      seen.push(useToast());
      return null;
    };

    const { rerender } = render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );

    act(() => {
      seen[0]!.addToast({ type: 'info', message: 'B3-toast', duration: 0 });
    });
    expect(screen.getByText('B3-toast')).toBeInTheDocument();

    // 子要素を新しいelementとして再描画させ、再度contextを読ませる
    rerender(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );

    expect(seen.length).toBeGreaterThanOrEqual(2);
    for (const api of seen) {
      expect(api.addToast).toBe(seen[0]!.addToast);
      expect(api.removeToast).toBe(seen[0]!.removeToast);
      expect(api.clearToasts).toBe(seen[0]!.clearToasts);
    }
  });

  it('removeToast/clearToastsは従来どおりtoastを消す', () => {
    let api: ToastApi | undefined;
    const Probe = () => {
      api = useToast();
      return null;
    };
    render(
      <ToastProvider>
        <Probe />
      </ToastProvider>
    );

    act(() => {
      api!.addToast({ type: 'success', message: 'first', duration: 0 });
      api!.addToast({ type: 'error', message: 'second', duration: 0 });
    });
    expect(screen.getByText('first')).toBeInTheDocument();
    expect(screen.getByText('second')).toBeInTheDocument();

    act(() => {
      api!.clearToasts();
    });
    expect(screen.queryByText('first')).not.toBeInTheDocument();
    expect(screen.queryByText('second')).not.toBeInTheDocument();
  });
});
