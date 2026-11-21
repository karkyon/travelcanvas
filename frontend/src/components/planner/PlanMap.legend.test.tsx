/**
 * [Gate② UX P0] 旅程の地図の凡例: 実際に引いた線の種類だけを出す(PlanMap を描いて確かめる)。
 * react-leaflet は jsdom で地図を描けないため、部品を中身だけ描く形に差し替える(線そのものの見た目は確かめない)。
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { DaySchedule } from '@/types';

const m = vi.hoisted(() => ({ getRouteGeometry: vi.fn() }));
vi.mock('react-leaflet', () => {
  const Pass = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
  return {
    MapContainer: Pass, TileLayer: () => null, Marker: Pass, Popup: Pass, Tooltip: Pass, Circle: Pass,
    Polyline: ({ pathOptions }: { pathOptions?: { dashArray?: string } }) =>
      <i data-testid="poly" data-dashed={pathOptions?.dashArray ? 'yes' : 'no'} />,
    useMap: () => ({ fitBounds: () => undefined, panTo: () => undefined, getBounds: () => ({ contains: () => true }), setView: () => undefined,
      on: () => undefined, off: () => undefined, getCenter: () => ({ lat: 0, lng: 0 }), getZoom: () => 13 }),
  };
});
vi.mock('leaflet', () => ({ default: { divIcon: () => ({}), latLngBounds: () => ({ isValid: () => true, pad: () => ({}) }) } }));
vi.mock('leaflet/dist/leaflet.css', () => ({}));
vi.mock('@/hooks/useHomePlace', () => ({ useHomePlace: () => ({ home: null, loaded: true }) }));
vi.mock('@/services/api/routeGeometry', () => ({ getRouteGeometry: m.getRouteGeometry }));

import PlanMap from './PlanMap';

const ev = (id: string, lat: number, lng: number, time: string) =>
  ({ id, title: id, category: 'sightseeing', latitude: lat, longitude: lng, start_time: time }) as unknown as DaySchedule['events'][number];
const day = (events: DaySchedule['events']): DaySchedule => ({ id: 'd1', date: '2026-12-20', events });

beforeEach(() => { m.getRouteGeometry.mockReset(); });

describe('PlanMap の凡例(線の種類)', () => {
  it('道の経路を聞かない時は、予定の順の点線を「直線・道ではない」と示す', () => {
    render(<PlanMap day={day([ev('a', 35.0, 135.7, '09:00'), ev('b', 35.01, 135.71, '10:00')])} />);
    expect(screen.getByTestId('plan-map-line-straight')).toHaveTextContent('予定の順(直線・道ではない)');
    expect(screen.queryByTestId('plan-map-line-road')).not.toBeInTheDocument();
  });

  it('場所が 1 つだけなら線も凡例も出さない', () => {
    render(<PlanMap day={day([ev('a', 35.0, 135.7, '09:00')])} />);
    expect(screen.queryByTestId('plan-map-legend')).not.toBeInTheDocument();
  });

  it('道の経路が返った区間は「道に沿った経路」、返らない区間は「直線(目安・道ではない)」', async () => {
    m.getRouteGeometry.mockResolvedValue({ provider: 'osrm', available: true, legs: [
      { index: 0, mode: 'walking', kind: 'road', coordinates: [[35.0, 135.7], [35.005, 135.705], [35.01, 135.71]] },
      { index: 1, mode: 'walking', kind: 'straight', coordinates: [] },
    ] });
    render(<PlanMap planId="p1" day={day([ev('a', 35.0, 135.7, '09:00'), ev('b', 35.01, 135.71, '10:00'), ev('c', 35.02, 135.72, '11:00')])} />);
    expect(await screen.findByTestId('plan-map-line-road', {}, { timeout: 3000 })).toHaveTextContent('道に沿った経路');
    expect(screen.getByTestId('plan-map-line-straight')).toHaveTextContent('直線(目安・道ではない)');
    // 凡例の種類と、実際に引いた線(実線・点線)が合う
    await waitFor(() => {
      const kinds = screen.getAllByTestId('poly').map((p) => p.getAttribute('data-dashed'));
      expect(kinds).toEqual(['no', 'yes']);
    });
  });

  it('道の経路を聞いて失敗した時は、直線の点線だけを示す(道に沿った経路を出さない)', async () => {
    m.getRouteGeometry.mockRejectedValue(new Error('down'));
    render(<PlanMap planId="p1" day={day([ev('a', 35.0, 135.7, '09:00'), ev('b', 35.01, 135.71, '10:00')])} />);
    await waitFor(() => expect(m.getRouteGeometry).toHaveBeenCalled(), { timeout: 3000 });
    expect(screen.getByTestId('plan-map-line-straight')).toBeInTheDocument();
    expect(screen.queryByTestId('plan-map-line-road')).not.toBeInTheDocument();
  });
});
