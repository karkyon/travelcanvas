import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const h = vi.hoisted(() => ({
  getHomePlace: vi.fn(), saveHomePlace: vi.fn(), deleteHomePlace: vi.fn(), geocodeAddress: vi.fn(),
}));
vi.mock('@/services/api/homePlace', () => ({ getHomePlace: h.getHomePlace, saveHomePlace: h.saveHomePlace, deleteHomePlace: h.deleteHomePlace }));
vi.mock('@/services/api/planEdit', () => ({ geocodeAddress: h.geocodeAddress }));
vi.mock('@/components/planner/SpotMiniMap', () => ({ default: ({ label }: { label: string }) => <div data-testid="mini-map">{label}</div> }));

import HomePlaceForm from './HomePlaceForm';
import { resetHomePlaceForTests } from '@/hooks/useHomePlace';

const empty = { configured: false, readable: true, revision: 0, place: null, show_on_map: true, use_for_routes: true, send_to_route_provider: false };

describe('[Gate HomePlace] 自宅の場所の設定', () => {
  beforeEach(() => {
    resetHomePlaceForTests();
    Object.values(h).forEach((f) => f.mockReset());
  });

  it('探して候補を選び、選んだ使い方で保存する(初めは提供元へ送らない)', async () => {
    h.getHomePlace.mockResolvedValue(empty);
    h.geocodeAddress.mockResolvedValue({ candidates: [{ address: '横浜市港北区', latitude: 35.52, longitude: 139.63, provider: 'nominatim', level: null }], sources: [], unavailable: false });
    h.saveHomePlace.mockImplementation(async (input) => ({ ...empty, configured: true, revision: 1, place: { label: input.label, address: input.address, latitude: input.latitude, longitude: input.longitude },
      show_on_map: input.show_on_map, use_for_routes: input.use_for_routes, send_to_route_provider: input.send_to_route_provider }));
    const done = vi.fn();
    render(<HomePlaceForm onDone={done} inDialog />);
    const box = await screen.findByLabelText(/住所・場所/);
    expect(screen.getByRole('checkbox', { name: /道に沿った経路にする/ })).not.toBeChecked();
    fireEvent.change(box, { target: { value: '港北区' } });
    fireEvent.click(screen.getByRole('button', { name: '探す' }));
    fireEvent.click(await screen.findByRole('button', { name: '横浜市港北区' }));
    expect(await screen.findByTestId('mini-map')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /旅程の地図に自宅の印を出す/ }));
    fireEvent.click(screen.getByRole('button', { name: '保存' }));
    await waitFor(() => expect(h.saveHomePlace).toHaveBeenCalledTimes(1));
    expect(h.saveHomePlace.mock.calls[0]).toEqual([expect.objectContaining({ latitude: 35.52, longitude: 139.63, show_on_map: false, use_for_routes: true, send_to_route_provider: false }), 0]);
    await waitFor(() => expect(done).toHaveBeenCalled());
  });

  it('経路に使わない時は「提供元へ送る」を選べない。登録済みなら消せる', async () => {
    h.getHomePlace.mockResolvedValue({ ...empty, configured: true, revision: 3, place: { label: '家', address: '港北区', latitude: 35.5, longitude: 139.6 }, send_to_route_provider: true });
    h.deleteHomePlace.mockResolvedValue(undefined);
    render(<HomePlaceForm />);
    const send = await screen.findByRole('checkbox', { name: /道に沿った経路にする/ });
    expect(send).toBeChecked();
    fireEvent.click(screen.getByRole('checkbox', { name: /出発・帰着の経路/ }));
    expect(send).toBeDisabled();
    expect(send).not.toBeChecked();
    h.getHomePlace.mockResolvedValue(empty);
    fireEvent.click(screen.getByRole('button', { name: '自宅の場所を消す' }));
    expect(await screen.findByText('自宅の場所を消しました')).toBeInTheDocument();
    expect(h.deleteHomePlace).toHaveBeenCalledTimes(1);
  });

  it('住所を送らずに、地図の印で決められる', async () => {
    h.getHomePlace.mockResolvedValue(empty);
    render(<HomePlaceForm />);
    fireEvent.click(await screen.findByRole('button', { name: /住所を送らず/ }));
    expect(await screen.findByTestId('mini-map')).toBeInTheDocument();
    expect(h.geocodeAddress).not.toHaveBeenCalled();
  });
});
