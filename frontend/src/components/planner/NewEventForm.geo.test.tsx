/**
 * [Gate② FC-027] 住所と地図の印が離れている時に確かめる(黙って動かさない・動かしたら知らせる)。
 */
import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const m = vi.hoisted(() => ({ geocodeAddress: vi.fn(), getPlaceInfo: vi.fn(), move: [34.5, 136.8] as [number, number] }));
vi.mock('@/services/api/planEdit', () => ({ geocodeAddress: m.geocodeAddress, getPlaceInfo: m.getPlaceInfo }));
// 地図の代わり: 押すと印を m.move へ動かす
vi.mock('./SpotMiniMap', () => ({
  default: ({ onMove }: { onMove: (lat: number, lng: number) => void }) =>
    <button type="button" data-testid="mini-map" onClick={() => onMove(m.move[0], m.move[1])}>map</button>,
}));

import NewEventForm from './NewEventForm';
import type { NewEventData } from './newEventLookup';
import { distanceM, distanceLabel, isFar } from './geoCheck';

type LookupState = { busy: boolean; result: Parameters<typeof NewEventForm>[0]['lookupState']['result']; error: string | null };

const Harness: React.FC<{ initial: NewEventData }> = ({ initial }) => {
  const [data, setData] = useState<NewEventData>(initial);
  const [urlRows, setUrlRows] = useState<string[]>(['']);
  const [stay, setStay] = useState({ h: '1', m: '0' });
  const [lookupState, setLookupState] = useState<LookupState>({ busy: false, result: null, error: null });
  return (
    <>
      <NewEventForm data={data} setData={setData} urlRows={urlRows} setUrlRows={setUrlRows} stay={stay} setStay={setStay}
        near={null} lookupState={lookupState} setLookupState={setLookupState} />
      <div data-testid="pos">{typeof data.latitude === 'number' ? `${data.latitude},${data.longitude}` : 'none'}</div>
    </>
  );
};
const found = (latitude: number, longitude: number) =>
  ({ candidates: [{ latitude, longitude, address: '三重県伊勢市宇治館町1' }], sources: [], unavailable: false });

beforeEach(() => { m.geocodeAddress.mockReset(); m.move = [34.5, 136.8]; });

describe('geoCheck', () => {
  it('距離と言い方・500 m の境', () => {
    const a = { latitude: 34.455, longitude: 136.725 };
    expect(distanceM(a, a)).toBe(0);
    expect(isFar(a, { latitude: 34.458, longitude: 136.725 })).toBe(false);  // 約 330 m
    expect(isFar(a, { latitude: 34.465, longitude: 136.725 })).toBe(true);   // 約 1.1 km
    expect(distanceLabel(1234)).toBe('約 1.2 km');
    expect(distanceLabel(804)).toBe('約 800 m');
  });
});

describe('住所と地図の印 (FC-027)', () => {
  it('今の印から離れた住所の位置は、黙って動かさず、どちらにするか確かめる', async () => {
    m.geocodeAddress.mockResolvedValue(found(34.455, 136.725));
    render(<Harness initial={{ title: '伊勢神宮', address: '三重県伊勢市宇治館町1', latitude: 34.49, longitude: 136.71 }} />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    const ask = await screen.findByTestId('new-geo-confirm');
    expect(ask).toHaveTextContent('離れています');
    expect(screen.getByTestId('pos').textContent).toBe('34.49,136.71');  // まだ動かさない
    fireEvent.click(screen.getByTestId('new-geo-use-address'));
    expect(screen.getByTestId('pos').textContent).toBe('34.455,136.725');
    expect(screen.queryByTestId('new-geo-confirm')).toBeNull();
  });

  it('「今の印のままにする」を選ぶと、印はそのまま', async () => {
    m.geocodeAddress.mockResolvedValue(found(34.455, 136.725));
    render(<Harness initial={{ title: '伊勢神宮', address: '三重県伊勢市宇治館町1', latitude: 34.49, longitude: 136.71 }} />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    fireEvent.click(await screen.findByTestId('new-geo-keep-pin'));
    expect(screen.getByTestId('pos').textContent).toBe('34.49,136.71');
    expect(screen.queryByTestId('new-geo-drifted')).toBeNull();
  });

  it('近い時は確かめずに入れる。その後に印を住所から遠くへ動かすと知らせ、住所の位置へ戻せる', async () => {
    m.geocodeAddress.mockResolvedValue(found(34.455, 136.725));
    render(<Harness initial={{ title: '伊勢神宮', address: '三重県伊勢市宇治館町1', latitude: 34.456, longitude: 136.725 }} />);
    fireEvent.click(screen.getByTestId('new-geocode'));
    await waitFor(() => expect(screen.getByTestId('pos').textContent).toBe('34.455,136.725'));
    expect(screen.queryByTestId('new-geo-confirm')).toBeNull();
    fireEvent.click(screen.getByTestId('mini-map'));  // 約 9 km 先へ動かした
    expect(await screen.findByTestId('new-geo-drifted')).toHaveTextContent('離れています');
    fireEvent.click(screen.getByTestId('new-geo-back'));
    expect(screen.getByTestId('pos').textContent).toBe('34.455,136.725');
    expect(screen.queryByTestId('new-geo-drifted')).toBeNull();
  });
});
