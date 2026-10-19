/** [Gate L5] 位置の記録中であることを全ての画面で示す(CA-014)。 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import RecordingIndicator from './RecordingIndicator';
import { useTrackingStore } from '@/store/trackingStore';

function renderAt(path: string) {
  return render(<MemoryRouter initialEntries={[path]}><RecordingIndicator /></MemoryRouter>);
}

beforeEach(() => {
  sessionStorage.clear();
  useTrackingStore.setState({ active: null });
});

describe('RecordingIndicator (Gate L5)', () => {
  it('記録中の軌跡が無ければ何も出さない', () => {
    renderAt('/dashboard');
    expect(screen.queryByTestId('recording-indicator')).toBeNull();
  });

  it('ほかの画面では記録中であることと、位置を取っていないことを示し、記録の画面へ案内する', () => {
    useTrackingStore.getState().setActive({ planId: 'p1', trackId: 't1', status: 'recording', capturing: false, tierLabel: null });
    renderAt('/dashboard');
    expect(screen.getByRole('status')).toHaveTextContent('位置の記録中の軌跡があります');
    expect(screen.getByRole('link', { name: '記録の画面へ' })).toHaveAttribute('href', '/planner/p1/track');
    // 再読込に備えて ID だけを保存する(座標は持たない)
    expect(JSON.parse(sessionStorage.getItem('tc_active_recording')!)).toEqual({ planId: 'p1', trackId: 't1', status: 'recording' });
  });

  it('記録の画面では出さない(画面自体に表示がある)。一時停止中はそう示す', () => {
    useTrackingStore.getState().setActive({ planId: 'p1', trackId: 't1', status: 'paused', capturing: false, tierLabel: null });
    const { unmount } = renderAt('/planner/p1/track');
    expect(screen.queryByTestId('recording-indicator')).toBeNull();
    unmount();
    renderAt('/planner/p1');
    expect(screen.getByRole('status')).toHaveTextContent('一時停止しています');
  });
});
