/** [Gate TravelEstimate] 運用コンソール: 移動の見積もりの条件の調整(試算・理由つきの保存・範囲外の誤り) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getTravelEstimate: vi.fn(), previewTravelEstimate: vi.fn(), saveTravelEstimate: vi.fn() }));
vi.mock('@/services/api/travelEstimate', () => api);

import AdminTravelEstimatePanel from './AdminTravelEstimatePanel';

const settings = (speed = 4.8, revision = 0) => ({
  schema: [
    { mode: 'walking', mode_label: '徒歩', key: 'speed_kmh', label: '歩く速さ', unit: 'km/h', min: 2, max: 8, default: 4.8 },
    { mode: 'car', mode_label: '車', key: 'highway_speed_kmh', label: '高速道路の平均の速さ', unit: 'km/h', min: 40, max: 120, default: 85 },
  ],
  params: { walking: { speed_kmh: speed }, car: { highway_speed_kmh: 85 } },
  revision, updated_at: revision ? '2026-11-10T03:00:00+00:00' : null, sample_km: [2],
  sample: [{ straight_km: 2, mode: 'walking', variants: [{ key: 'walk', label: '徒歩', distance_km: 2.5, duration_minutes: 31 }] }],
  note: '直線距離をもとにした目安です。',
});

describe('移動の見積もりの条件', () => {
  beforeEach(() => { vi.clearAllMocks(); api.getTravelEstimate.mockResolvedValue(settings()); });

  it('手段ごとに条件を出し、変えて試算し、理由を入れて保存する', async () => {
    render(<AdminTravelEstimatePanel />);
    const input = await screen.findByLabelText(/歩く速さ/);
    expect(screen.getByTestId('te-sample')).toHaveTextContent('徒歩 31分(2.5km)');
    expect(screen.getByTestId('te-save')).toBeDisabled();
    fireEvent.change(input, { target: { value: '4' } });
    api.previewTravelEstimate.mockResolvedValue([{ straight_km: 2, mode: 'walking', variants: [
      { key: 'walk', label: '徒歩', distance_km: 2.5, duration_minutes: 38 }] }]);
    fireEvent.click(screen.getByTestId('te-preview'));
    await waitFor(() => expect(screen.getByTestId('te-sample')).toHaveTextContent('徒歩 38分'));
    expect(api.previewTravelEstimate).toHaveBeenCalledWith({ walking: { speed_kmh: 4 }, car: { highway_speed_kmh: 85 } });
    expect(screen.getByTestId('te-save')).toBeDisabled(); // 理由が無い
    fireEvent.change(screen.getByTestId('te-reason'), { target: { value: '高齢の家族に合わせる' } });
    api.saveTravelEstimate.mockResolvedValue(settings(4, 1));
    fireEvent.click(screen.getByTestId('te-save'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('保存しました(版 1)'));
    expect(api.saveTravelEstimate).toHaveBeenCalledWith({ walking: { speed_kmh: 4 }, car: { highway_speed_kmh: 85 } }, '高齢の家族に合わせる');
  });

  it('範囲の外は server の誤りを並べて出し、既定に戻せる', async () => {
    render(<AdminTravelEstimatePanel />);
    fireEvent.change(await screen.findByLabelText(/歩く速さ/), { target: { value: '20' } });
    api.previewTravelEstimate.mockRejectedValue({ response: { status: 422, data: { detail: {
      code: 'travel_estimate_invalid', message: '徒歩・歩く速さ: 2〜8km/hの範囲にしてください',
      errors: ['徒歩・歩く速さ: 2〜8km/hの範囲にしてください', '車・高速道路の平均の速さ: 40〜120km/hの範囲にしてください'] } } } });
    fireEvent.click(screen.getByTestId('te-preview'));
    expect(await screen.findByText('車・高速道路の平均の速さ: 40〜120km/hの範囲にしてください')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('te-defaults'));
    expect(screen.getByLabelText(/歩く速さ/)).toHaveValue(4.8);
  });
});
