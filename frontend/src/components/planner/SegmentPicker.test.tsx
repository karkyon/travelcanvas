/**
 * [Gate PlanUX] 予定と予定の間の移動手段: 押した時だけ印を出し、印で決める。詳細(時刻・列車名・座席)は後から入れる。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

const api = vi.hoisted(() => ({ createSegment: vi.fn(), updateSegment: vi.fn() }));
vi.mock('@/services/api', () => api);

import SegmentPicker from './SegmentPicker';
import type { TravelSegment } from '@/services/api/types/segments';

const seg = (over: Partial<TravelSegment> = {}): TravelSegment => ({
  id: 's1', plan_id: 'p1', from_event_id: 'e1', from_place_id: null, to_event_id: 'e2', to_place_id: null, mode: 'train',
  status: 'planned', planned_departure_at: null, planned_arrival_at: null, distance_km: null, duration_minutes: null,
  cost: null, currency: null, preparation_minutes: 0, buffer_before_minutes: 0, buffer_after_minutes: 0,
  transport_number: null, platform: null, transfer_count: null, luggage_note: null, reservation_id: null, is_estimate: false,
  provider: 'user', algorithm_version: 'v1', computed_at: '2026-11-04T00:00:00Z', recommended_departure_at: null,
  revision: 1, created_at: '2026-11-04T00:00:00Z', updated_at: null, ...over,
} as TravelSegment);

function setup(segment: TravelSegment | null, over: { mismatch?: boolean; canEdit?: boolean } = {}) {
  const onSaved = vi.fn();
  render(
    <MemoryRouter>
      <SegmentPicker planId="p1" revision={7} fromEventId="e1" fromTitle="京都駅" toEventId="e2" toTitle="東京駅"
        segment={segment} canEdit={over.canEdit ?? true} mismatch={over.mismatch} onSaved={onSaved}>
        {segment ? <div data-testid="segment-row">{segment.mode}</div> : undefined}
      </SegmentPicker>
    </MemoryRouter>,
  );
  return { onSaved };
}

describe('予定の間の移動手段', () => {
  beforeEach(() => { api.createSegment.mockReset(); api.updateSegment.mockReset(); });

  it('印は常には出さず、「移動手段を選ぶ」で出す。印を押すとその移動手段で区間を作る', async () => {
    api.createSegment.mockResolvedValue(seg({ mode: 'shinkansen' }));
    const { onSaved } = setup(null);
    expect(screen.getByTestId('segment-empty')).toHaveTextContent('「京都駅」→「東京駅」 · 移動手段未設定');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByTestId('segment-choose-e2'));
    const modes = screen.getByRole('radiogroup', { name: '「京都駅」から「東京駅」への移動手段' });
    expect(modes).toHaveTextContent('徒歩');
    expect(modes).toHaveTextContent('ヘリ(要手配)');
    fireEvent.click(screen.getByTestId('segment-mode-shinkansen'));
    await waitFor(() => expect(api.createSegment).toHaveBeenCalledWith('p1',
      { from_event_id: 'e1', to_event_id: 'e2', mode: 'shinkansen' }, expect.any(String)));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
    expect(screen.queryByRole('radiogroup')).toBeNull();
  });

  it('前後が合わない区間は、選び直すと今の前の予定から着く区間に直す(旅程の版で送る)', async () => {
    api.updateSegment.mockResolvedValue(seg({ mode: 'taxi' }));
    setup(seg({ from_event_id: 'old' }), { mismatch: true });
    fireEvent.click(screen.getByTestId('segment-choose-e2'));
    expect(screen.getByTestId('segment-mode-train')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByTestId('segment-mode-taxi'));
    await waitFor(() => expect(api.updateSegment).toHaveBeenCalledWith('p1', 's1',
      { mode: 'taxi', from_event_id: 'e1', from_place_id: undefined }, 7));
  });

  it('新幹線の詳細(出発・到着・列車名・号車座席・費用・メモ)を後から入れる。予約番号は予約へ', async () => {
    api.updateSegment.mockResolvedValue(seg({ mode: 'shinkansen', transport_number: 'のぞみ 21号' }));
    const { onSaved } = setup(seg({ mode: 'shinkansen' }));
    fireEvent.click(screen.getByTestId('segment-detail-e2'));
    const dialog = screen.getByTestId('segment-detail-dialog');
    expect(dialog).toHaveTextContent('予約番号・チケットは予約に保存します');
    fireEvent.change(screen.getByLabelText('列車名・号数(例: のぞみ 21号)'), { target: { value: 'のぞみ 21号' } });
    fireEvent.change(screen.getByLabelText('号車・座席・番線'), { target: { value: '7号車 12A' } });
    fireEvent.change(screen.getByLabelText('費用(JPY)'), { target: { value: '13870' } });
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(api.updateSegment).toHaveBeenCalledWith('p1', 's1',
      { transport_number: 'のぞみ 21号', platform: '7号車 12A', cost: '13870', currency: 'JPY' }, 7));
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it('見るだけの人には選ぶ・詳細のボタンを出さない', () => {
    setup(seg(), { canEdit: false });
    expect(screen.queryByTestId('segment-choose-e2')).toBeNull();
    expect(screen.queryByTestId('segment-detail-e2')).toBeNull();
  });
});
