/**
 * [Gate M9-FE-B3] MapView: 依存を正しく宣言した後も地図インスタンスは1回だけ生成され、
 * マーカーのclickは常に最新のonLocationClickを呼ぶこと。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render } from '@testing-library/react';

// env.tsはimport時に必須環境変数を検証するため、テストではAPIキーだけを差し替える
vi.mock('../../config/env', () => ({ env: { GOOGLE_MAPS_API_KEY: 'test-key' } }));

import MapView from './MapView';

interface FakeMarker {
  listeners: Record<string, () => void>;
}

let mapCtorCount = 0;
let markers: FakeMarker[] = [];

function installFakeGoogle() {
  mapCtorCount = 0;
  markers = [];
  class FakeMap {
    constructor() {
      mapCtorCount += 1;
    }
    setMapTypeId() {}
    setCenter() {}
    setZoom() {}
    fitBounds() {}
  }
  class FakeMarkerImpl implements FakeMarker {
    listeners: Record<string, () => void> = {};
    constructor() {
      markers.push(this);
    }
    addListener(event: string, handler: () => void) {
      this.listeners[event] = handler;
    }
  }
  class FakeInfoWindow {
    open() {}
  }
  class FakeBounds {
    extend() {}
  }
  window.google = {
    maps: {
      Map: FakeMap,
      Marker: FakeMarkerImpl,
      InfoWindow: FakeInfoWindow,
      LatLngBounds: FakeBounds,
      LatLng: class {},
      DirectionsService: class { route() {} },
      DirectionsRenderer: class { setMap() {} setDirections() {} },
      SymbolPath: { CIRCLE: 0 },
      TravelMode: { TRANSIT: 'TRANSIT' },
    },
  } as unknown as Window['google'];
}

const makeLocations = () => [
  { id: 'l1', name: 'A', latitude: 35, longitude: 139, category: 'x' },
];

describe('MapView (Gate M9-FE-B3)', () => {
  beforeEach(() => installFakeGoogle());
  afterEach(() => {
    delete window.google;
  });

  it('locations配列・onLocationClickが毎回新しくても地図は1回だけ生成される', () => {
    const { rerender } = render(<MapView locations={makeLocations()} onLocationClick={() => {}} />);
    rerender(<MapView locations={makeLocations()} onLocationClick={() => {}} />);
    rerender(<MapView locations={makeLocations()} onLocationClick={() => {}} />);
    expect(mapCtorCount).toBe(1);
  });

  it('onLocationClickだけが変わってもマーカーを作り直さず、clickは最新のcallbackを呼ぶ', () => {
    const locations = makeLocations();
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<MapView locations={locations} onLocationClick={first} />);
    const markerCountAfterMount = markers.length;
    expect(markerCountAfterMount).toBe(1);

    rerender(<MapView locations={locations} onLocationClick={second} />);
    expect(markers.length).toBe(markerCountAfterMount);

    markers[0]!.listeners.click!();
    expect(second).toHaveBeenCalledWith(locations[0]);
    expect(first).not.toHaveBeenCalled();
  });
});
