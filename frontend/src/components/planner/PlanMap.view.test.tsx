/**
 * [Gate② UX P0] 旅程の地図の表示範囲を、旅行と日ごとに覚えて戻す(mapViewMemory)。
 * react-leaflet は jsdom で地図を描けないため、地図の操作(setView・fitBounds・moveend)を記録する偽物に差し替える。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import type { DaySchedule } from '@/types';

const fake = vi.hoisted(() => {
  const state = { center: { lat: 0, lng: 0 }, zoom: 13, handlers: [] as (() => void)[] };
  const map = {
    setView: vi.fn((c: [number, number], z: number) => { state.center = { lat: c[0], lng: c[1] }; state.zoom = z; }),
    fitBounds: vi.fn(() => { state.center = { lat: 35.005, lng: 135.705 }; state.zoom = 15; }),
    panTo: vi.fn(), getBounds: () => ({ pad: () => ({ contains: () => true }) }),
    getCenter: () => state.center, getZoom: () => state.zoom,
    on: (_: string, h: () => void) => { state.handlers.push(h); },
    off: (_: string, h: () => void) => { state.handlers = state.handlers.filter((x) => x !== h); },
  };
  /** 利用者が地図を動かした(中心と拡大が変わり、moveend が来る) */
  const userMoves = (lat: number, lng: number, zoom: number) => {
    state.center = { lat, lng }; state.zoom = zoom; state.handlers.forEach((h) => h());
  };
  return { map, state, userMoves };
});
vi.mock('react-leaflet', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return { MapContainer: Pass, TileLayer: () => null, Marker: Pass, Popup: Pass, Tooltip: Pass, Circle: Pass, Polyline: () => null,
    useMap: () => fake.map };
});
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}), latLngBounds: () => ({ isValid: () => true, pad: () => ({}) }), latLng: () => ({}) } }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/hooks/useHomePlace', () => ({ useHomePlace: () => ({ home: null, loaded: true }) }));
vi.mock('@/services/api/routeGeometry', () => ({ getRouteGeometry: vi.fn().mockResolvedValue({ legs: [] }) }));

import PlanMap from './PlanMap';
import { forgetMapViews } from './mapViewMemory';

const ev = (id: string, lat: number, lng: number) =>
  ({ id, title: id, category: 'sightseeing', latitude: lat, longitude: lng }) as unknown as DaySchedule['events'][number];
const day = (id: string, events: DaySchedule['events']): DaySchedule => ({ id, date: '2026-12-20', events });
const two = [ev('a', 35.0, 135.7), ev('b', 35.01, 135.71)];

beforeEach(() => { forgetMapViews(); fake.map.setView.mockClear(); fake.map.fitBounds.mockClear(); fake.state.handlers = []; });

describe('PlanMap の表示範囲を覚える', () => {
  it('動かした範囲は、画面を離れて戻っても(同じ旅行・同じ日・同じ印なら)そのまま出す', () => {
    const first = render(<PlanMap planId="p1" day={day('d1', two)} />);
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);  // 初めは印に合わせる
    fake.userMoves(34.9, 135.6, 12);
    first.unmount();
    fake.map.fitBounds.mockClear();
    render(<PlanMap planId="p1" day={day('d1', two)} />);
    expect(fake.map.fitBounds).not.toHaveBeenCalled();
    expect(fake.map.setView).toHaveBeenLastCalledWith([34.9, 135.6], 12);
  });

  it('印が変わった時(予定を足した等)・別の日・別の旅行では、覚えた範囲を使わず印に合わせる', () => {
    const first = render(<PlanMap planId="p1" day={day('d1', two)} />);
    fake.userMoves(34.9, 135.6, 12);
    first.unmount();
    for (const props of [
      { planId: 'p1', day: day('d1', [...two, ev('c', 35.02, 135.72)]) },
      { planId: 'p1', day: day('d2', two) },
      { planId: 'p2', day: day('d1', two) },
    ]) {
      fake.map.fitBounds.mockClear();
      const v = render(<PlanMap {...props} />);
      expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
      v.unmount();
    }
  });

  it('ログアウト(forgetMapViews)の後は覚えた範囲を使わない', () => {
    const first = render(<PlanMap planId="p1" day={day('d1', two)} />);
    fake.userMoves(34.9, 135.6, 12);
    first.unmount();
    forgetMapViews();
    fake.map.fitBounds.mockClear();
    render(<PlanMap planId="p1" day={day('d1', two)} />);
    expect(fake.map.fitBounds).toHaveBeenCalledTimes(1);
  });
});
