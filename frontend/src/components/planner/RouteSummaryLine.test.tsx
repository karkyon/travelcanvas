/**
 * [G11-Layout] 地図の下の移動概算の行は、読み込み中・読めない時も同じ場所に1行を出す(値を作らない)。
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import RouteSummaryLine from './RouteSummaryLine';
import type { RoutePreview } from '@/services/api';

const preview = (over: Partial<RoutePreview> = {}): RoutePreview => ({
  legs: [], total_distance_km: 3.2, total_duration_minutes: 41.6, ...over,
} as unknown as RoutePreview);

describe('RouteSummaryLine', () => {
  it('読み込み中・読めた・読めない・一部不明を同じ場所の1行で出す', () => {
    const { rerender } = render(<RouteSummaryLine status="loading" preview={null} />);
    const line = screen.getByTestId('route-summary');
    expect(line).toHaveAttribute('data-status', 'loading');
    expect(line).toHaveAttribute('aria-busy', 'true');
    expect(line).toHaveTextContent('この日の移動概算を読み込んでいます');
    expect(line).not.toHaveTextContent('km');

    rerender(<RouteSummaryLine status="ready" preview={preview()} />);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('この日の移動概算: 約3.2km・約42分');
    expect(screen.getByTestId('route-summary')).toHaveTextContent('確定値ではありません');

    rerender(<RouteSummaryLine status="ready" preview={preview({ total_distance_km: null })} />);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('一部区間の移動概算は算出できません');

    rerender(<RouteSummaryLine status="failed" preview={null} />);
    expect(screen.getByTestId('route-summary')).toHaveTextContent('この日の移動概算を読めませんでした');
    expect(screen.getByTestId('route-summary')).not.toHaveTextContent('km');
  });

  it('概算を使わない時(ゲスト・日が無い)は行を出さない', () => {
    render(<RouteSummaryLine status="off" preview={null} />);
    expect(screen.queryByTestId('route-summary')).toBeNull();
  });
});
