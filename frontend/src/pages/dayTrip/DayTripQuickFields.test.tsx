/** [FR-061] 新しい旅行(日帰り)の欄: 目的地・出発地(丸め)・道の使い方・時刻の確かめ */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/components/search/PlaceFinder', () => ({
  default: ({ onPick, pickLabel }: { onPick: (d: unknown) => void; pickLabel: string }) => (
    <button type="button" onClick={() => onPick({ name: '桂坂野鳥遊園', address: '京都市西京区', latitude: 34.98, longitude: 135.66,
      category: null, description: null, sourceUrl: null })}>{pickLabel}</button>),
}));
vi.mock('@/services/api/homePlace', () => ({ getHomePlace: vi.fn(async () => ({ place: { label: '自宅', address: null, latitude: 34.81234, longitude: 135.64321 } })) }));

import DayTripQuickFields from './DayTripQuickFields';
import { dayTripProblem, emptyDayTrip, type DayTripDraft } from './dayTripDraft';

describe('日帰りの欄', () => {
  it('目的地・現在地(小数 2 桁に丸める)・道の使い方', async () => {
    let v: DayTripDraft = emptyDayTrip('2030-05-03');
    const onChange = vi.fn((d: DayTripDraft) => { v = d; });
    Object.defineProperty(navigator, 'geolocation', { configurable: true, value: {
      getCurrentPosition: (ok: PositionCallback) => ok({ coords: { latitude: 34.98765, longitude: 135.70432, accuracy: 30 } } as GeolocationPosition) } });
    const { rerender } = render(<DayTripQuickFields value={v} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: '目的地にする' }));
    expect(v.dest).toEqual({ label: '桂坂野鳥遊園', lat: 34.98, lng: 135.66, spot_id: null });
    rerender(<DayTripQuickFields value={v} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /現在地/ }));
    expect(v.origin).toEqual({ label: '現在地のあたり', lat: 34.99, lng: 135.7 });
    rerender(<DayTripQuickFields value={v} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('dt-road-local'));
    expect(v.road).toBe('local');
    expect(dayTripProblem(v)).toBeNull();
  });

  it('確かめ: 目的地の位置・出発地・時刻の順', () => {
    const base = { ...emptyDayTrip('2030-05-03'), dest: { label: 'x', lat: 1, lng: 1 }, origin: { label: 'y', lat: 1, lng: 1 } };
    expect(dayTripProblem(emptyDayTrip())?.code).toBe('day_trip_dest_missing');
    expect(dayTripProblem({ ...base, dest: { label: 'x', lat: null as unknown as number, lng: 1 } })?.code).toBe('day_trip_dest_unlocated');
    expect(dayTripProblem({ ...base, origin: null })?.code).toBe('day_trip_origin_missing');
    expect(dayTripProblem({ ...base, homeBy: '08:00' })?.text).toBe('家に着きたい時刻は出発の後にしてください');
    expect(dayTripProblem({ ...base, date: '' })?.code).toBe('day_trip_date_missing');
  });
});
