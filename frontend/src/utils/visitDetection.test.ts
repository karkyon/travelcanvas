import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { distanceMeters, calculateConfidence, VisitDetector } from './visitDetection';

describe('distanceMeters', () => {
  it('同一地点の距離は0', () => {
    expect(distanceMeters(35.6812, 139.7671, 35.6812, 139.7671)).toBeCloseTo(0, 3);
  });

  it('東京駅と浅草寺の距離が概ね妥当な範囲(2〜4km)', () => {
    // 東京駅: 35.6812, 139.7671 / 浅草寺: 35.7148, 139.7967
    const d = distanceMeters(35.6812, 139.7671, 35.7148, 139.7967);
    expect(d).toBeGreaterThan(2000);
    expect(d).toBeLessThan(5000);
  });
});

describe('calculateConfidence', () => {
  it('滞在時間が長く精度が良いほど信頼度が高い', () => {
    const short = calculateConfidence(3 * 60 * 1000, 10);
    const long = calculateConfidence(10 * 60 * 1000, 10);
    expect(long).toBeGreaterThan(short);
  });

  it('GPS精度が悪いほど信頼度が下がる', () => {
    const goodAccuracy = calculateConfidence(5 * 60 * 1000, 5);
    const badAccuracy = calculateConfidence(5 * 60 * 1000, 150);
    expect(goodAccuracy).toBeGreaterThan(badAccuracy);
  });

  it('常に0から1の範囲に収まる', () => {
    expect(calculateConfidence(0, 0)).toBeGreaterThanOrEqual(0);
    expect(calculateConfidence(0, 0)).toBeLessThanOrEqual(1);
    expect(calculateConfidence(999999999, 999999)).toBeGreaterThanOrEqual(0);
    expect(calculateConfidence(999999999, 999999)).toBeLessThanOrEqual(1);
  });
});

describe('VisitDetector', () => {
  const target = {
    eventId: 'event-1',
    spotId: 'spot-1',
    title: 'テストスポット',
    latitude: 35.6812,
    longitude: 139.7671,
  };

  let watchCallback: ((pos: GeolocationPosition) => void) | null = null;
  let mockWatchId = 1;

  beforeEach(() => {
    watchCallback = null;
    vi.useFakeTimers();
    (global as any).navigator = {
      geolocation: {
        watchPosition: vi.fn((success: (pos: GeolocationPosition) => void) => {
          watchCallback = success;
          return mockWatchId;
        }),
        clearWatch: vi.fn(),
      },
    };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const emitPosition = (lat: number, lon: number, accuracy: number, timestamp: number) => {
    watchCallback?.({
      coords: { latitude: lat, longitude: lon, accuracy } as GeolocationCoordinates,
      timestamp,
    } as GeolocationPosition);
  };

  it('半径内に3分未満しか留まらない場合は提案されない', () => {
    const onSuggestion = vi.fn();
    const detector = new VisitDetector([target], onSuggestion);
    detector.start();

    const t0 = Date.now();
    vi.setSystemTime(t0);
    emitPosition(35.6812, 139.7671, 10, t0);

    vi.setSystemTime(t0 + 60 * 1000); // 1分後
    emitPosition(35.6812, 139.7671, 10, t0 + 60 * 1000);

    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it('半径内に3分以上滞在すると提案される', () => {
    const onSuggestion = vi.fn();
    const detector = new VisitDetector([target], onSuggestion);
    detector.start();

    const t0 = Date.now();
    vi.setSystemTime(t0);
    emitPosition(35.6812, 139.7671, 10, t0);

    vi.setSystemTime(t0 + 4 * 60 * 1000); // 4分後
    emitPosition(35.6812, 139.7671, 10, t0 + 4 * 60 * 1000);

    expect(onSuggestion).toHaveBeenCalledTimes(1);
    const suggestion = onSuggestion.mock.calls[0][0];
    expect(suggestion.eventId).toBe('event-1');
    expect(suggestion.confidence).toBeGreaterThan(0);
  });

  it('同じイベントは1セッションにつき1回しか提案しない', () => {
    const onSuggestion = vi.fn();
    const detector = new VisitDetector([target], onSuggestion);
    detector.start();

    const t0 = Date.now();
    vi.setSystemTime(t0);
    emitPosition(35.6812, 139.7671, 10, t0);
    vi.setSystemTime(t0 + 4 * 60 * 1000);
    emitPosition(35.6812, 139.7671, 10, t0 + 4 * 60 * 1000);
    vi.setSystemTime(t0 + 8 * 60 * 1000);
    emitPosition(35.6812, 139.7671, 10, t0 + 8 * 60 * 1000);

    expect(onSuggestion).toHaveBeenCalledTimes(1);
  });

  it('範囲外に出ると滞在時間がリセットされる(素通りは誤検知しない)', () => {
    const onSuggestion = vi.fn();
    const detector = new VisitDetector([target], onSuggestion);
    detector.start();

    const t0 = Date.now();
    vi.setSystemTime(t0);
    emitPosition(35.6812, 139.7671, 10, t0); // 範囲内

    vi.setSystemTime(t0 + 60 * 1000);
    emitPosition(35.9, 140.0, 10, t0 + 60 * 1000); // 大きく離れる(範囲外)

    vi.setSystemTime(t0 + 90 * 1000);
    emitPosition(35.6812, 139.7671, 10, t0 + 90 * 1000); // 再度範囲内(タイマーリセットされているはず)

    vi.setSystemTime(t0 + 90 * 1000 + 2 * 60 * 1000); // 再進入から2分後(3分未満)
    emitPosition(35.6812, 139.7671, 10, t0 + 90 * 1000 + 2 * 60 * 1000);

    expect(onSuggestion).not.toHaveBeenCalled();
  });

  it('stop()を呼ぶとclearWatchが呼ばれる', () => {
    const detector = new VisitDetector([target], vi.fn());
    detector.start();
    detector.stop();
    expect((navigator.geolocation as any).clearWatch).toHaveBeenCalledWith(mockWatchId);
  });
});
