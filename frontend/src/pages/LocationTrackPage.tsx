/**
 * LocationTrackPage - 任意の位置軌跡(DOC-04 SC-43 Privacy & Location、DOC-14 §4.4 TRACK、FR-038)。
 *
 * [Gate P13] backend/app/api/v1/location_tracks.py の画面。
 * - 記録は明示的に開始する(既定はOFF)。位置情報の利用への同意と、旅行の期間内であることが必要
 * - 記録中は常に表示し、一時停止・停止をすぐ押せる。記録はこの画面を開いている間だけ行う(ブラウザの制約)
 * - 軌跡は本人だけが見られる。任意の時間帯の点の削除・軌跡の削除ができる
 * [Gate L5] FR-055 Local-first Location(CA-013)・FR-056 適応型GPS(CA-014)
 * - 旅行ごとに位置の扱いを選ぶ: 記録しない / この端末だけ / 訪問地域だけ同期(生の座標は端末だけ)/ 暗号化してサーバーへ
 * - 移動の速さ・止まっているか・電池の残量に応じて位置を取る頻度を変える(utils/adaptiveSampler.ts)。省電力・手動の記録
 * - 記録の観測値(電池の消費・欠測率)を軌跡に残す。ほかの画面でも記録中であることを示す(RecordingIndicator)
 * [Gate V2] FR-051 保護エリア(自宅・職場など。CA-009): この端末の中だけに置き、中で取れた位置は保存も送信もしない
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  changeLocationTrack, deleteLocationTrack, deleteTrackPoints, getLocationSettings, getLocationTrack, getLocationTracks,
  putLocationSettings, putTrackSampling, startLocationTrack, updateConsents, uploadAreaCells, uploadTrackPoints,
} from '@/services/api';
import type {
  AreaCell, LocationTrack, LocationTrackList, TrackMode, TrackPoint, TrackPrecision, TrackSampling, TripLocationMode,
} from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  MAX_ACCURACY_M, PRECISION, addPending, appendLocalPoint, clearLocalTrack, deleteLocalRange, loadLocalPoints,
  loadPending, pendingCount, removePending, toTrackPoint, totalDistanceM,
} from '@/utils/trackRecorder';
import {
  SamplingStats, addFix, clearStatsSnapshot, currentSpeed, decideTier, emptyMotion, keepWithTier, loadStatsSnapshot,
  readBattery, resumeSnapshot, saveStatsSnapshot, stationaryForMs, type BatteryState, type MotionState, type TierSetting,
} from '@/utils/adaptiveSampler';
import { aggregateAreaCells, chunkCells } from '@/utils/areaCells';
import { ZONE_RADII, addZone, inProtectedZone, loadZones, removeZone, type ProtectedZone } from '@/utils/protectedZones';
import { useTrackingStore } from '@/store/trackingStore';

const MODE_LABEL: Record<TrackMode, string> = {
  device_only: 'この端末だけ', areas_only: '訪問地域だけ同期', synced: '暗号化してサーバーへ',
};
const TRIP_MODE_OPTIONS: Array<{ value: TripLocationMode; label: string }> = [
  { value: 'off', label: '記録しない' },
  { value: 'device_only', label: 'この端末だけ(座標をサーバーへ送りません)' },
  { value: 'areas_only', label: '訪問地域だけ同期(座標は端末だけ。約11kmの区画と滞在時間だけを送ります)' },
  { value: 'synced', label: '暗号化してサーバーへ(ほかの端末からも見られます)' },
];
const STATUS_LABEL = { recording: '記録中', paused: '一時停止中', stopped: '停止' } as const;
const REASON_LABEL = {
  user: '自分で停止', trip_ended: '旅行の期間が終わったため停止', consent_withdrawn: '同意を撤回したため停止',
  mode_off: '「記録しない」に変えたため停止',
} as const;
const CELL_STATE_LABEL = { STAYED: '滞在', VISITED: '訪問', PASS_THROUGH: '通過' } as const;

const showTime = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
};

const toIso = (local: string): string | null => {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

const formatDistance = (m: number): string => (m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);
const pct = (v: number) => `${Math.round(v * 100)}%`;

function samplingSummary(s: TrackSampling | null): string | null {
  if (!s) return null;
  const parts: string[] = [];
  if (s.missed_ratio !== null) parts.push(`欠測率 ${pct(s.missed_ratio)}`);
  if (s.battery_used !== null) parts.push(`電池の消費 ${pct(s.battery_used)}`);
  if (s.manual_points) parts.push(`手動の記録 ${s.manual_points}件`);
  return parts.length ? parts.join('・') : null;
}

/** 地図を使わない軌跡の略図(点を正規化して線で結ぶ)。内容は文章でも示す */
const TrackSketch: React.FC<{ points: TrackPoint[]; label: string }> = ({ points, label }) => {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, maxLng - minLng) || 1;
  const xy = points.map((p) => `${(((p.longitude - minLng) / span) * 180 + 10).toFixed(1)},${(190 - ((p.latitude - minLat) / span) * 180).toFixed(1)}`);
  return (
    <svg viewBox="0 0 200 200" width="160" height="160" role="img" aria-label={label} className="border border-gray-200 rounded-sm bg-gray-50">
      <polyline points={xy.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
};

const LocationTrackPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LocationTrackList | null>(null);
  const [settingRevision, setSettingRevision] = useState(0);
  const [tripMode, setTripMode] = useState<TripLocationMode | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [precision, setPrecision] = useState<TrackPrecision>('standard');
  const [busy, setBusy] = useState(false);
  const [collected, setCollected] = useState(0);
  const [pending, setPending] = useState(0);
  const [syncedCells, setSyncedCells] = useState<number | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [tier, setTier] = useState<TierSetting | null>(null);
  const [battery, setBattery] = useState<BatteryState | null>(null);
  const [lowPowerManual, setLowPowerManual] = useState(false);
  const [details, setDetails] = useState<Record<string, { points: TrackPoint[]; distance: number; cells: AreaCell[] }>>({});
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  // [Gate V2] 保護エリア(この端末だけ)
  const [zones, setZones] = useState<ProtectedZone[]>(() => loadZones());
  const [zoneLabel, setZoneLabel] = useState('');
  const [zoneRadius, setZoneRadius] = useState<number>(ZONE_RADII[1]);
  const [zoneSkipped, setZoneSkipped] = useState(0);
  const zonesRef = useRef<ProtectedZone[]>(zones);
  zonesRef.current = zones;
  const lastPoint = useRef<TrackPoint | null>(null);
  const flushing = useRef(false);
  const stats = useRef<{ trackId: string; stats: SamplingStats } | null>(null);
  const manualRecord = useRef<(() => void) | null>(null);
  const setActiveRecording = useTrackingStore((s) => s.setActive);
  const setCapturing = useTrackingStore((s) => s.setCapturing);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      const [list, settings] = await Promise.all([getLocationTracks(planId), getLocationSettings(planId)]);
      setData(list);
      setSettingRevision(settings.revision);
      setTripMode((cur) => cur ?? settings.mode);
    } catch (e) {
      setError(errorDetailMessage(e, '位置の記録の取得に失敗しました'));
    } finally {
      setIsLoading(false);
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const active: LocationTrack | undefined = data?.tracks.find((t) => t.id === data.active_track_id);

  // [Gate L5] ほかの画面でも記録中であることを示す(座標は渡さない)
  useEffect(() => {
    if (!planId || !data) return;
    if (active && active.status !== 'stopped') {
      setActiveRecording({ planId, trackId: active.id, status: active.status, capturing: false, tierLabel: null });
    } else {
      const cur = useTrackingStore.getState().active;
      if (cur && cur.planId === planId) setActiveRecording(null);
    }
  }, [planId, data, active, setActiveRecording]);

  const statsFor = useCallback((track: LocationTrack): SamplingStats => {
    if (!stats.current || stats.current.trackId !== track.id) {
      stats.current = {
        trackId: track.id, stats: new SamplingStats(resumeSnapshot(loadStatsSnapshot(track.id), track.sampling)),
      };
    }
    return stats.current.stats;
  }, []);

  const reportSampling = useCallback(async (track: LocationTrack) => {
    if (!planId || !stats.current || stats.current.trackId !== track.id) return;
    try {
      await putTrackSampling(planId, track.id, stats.current.stats.snapshot());
    } catch {
      // 観測値が送れなくても記録は止めない(次に送る)
    }
  }, [planId]);

  const flush = useCallback(async (track: LocationTrack) => {
    if (!planId || track.mode === 'device_only' || flushing.current) return;
    flushing.current = true;
    try {
      if (track.mode === 'areas_only') {
        // [Gate L5] 生の座標は送らない。端末の点から区画を集計して送る(同じ区画は合わせられる)
        const cells = aggregateAreaCells(loadLocalPoints(track.id));
        let count: number | null = null;
        for (const chunk of chunkCells(cells)) {
          const res = await uploadAreaCells(planId, track.id, chunk);
          count = res.cell_count;
          if (res.status !== 'recording') break;
        }
        if (count !== null) setSyncedCells(count);
      } else {
        for (const batch of loadPending(track.id)) {
          const res = await uploadTrackPoints(planId, track.id, batch.batch_id, batch.points);
          removePending(track.id, batch.batch_id);
          if (res.status !== 'recording') break;
        }
      }
    } catch (e) {
      // 送れなかったまとまりは端末に残し、同じbatch_idで送り直す
      setError(errorDetailMessage(e, '位置を送れませんでした。通信が戻ったら「今すぐ送る」を押してください'));
    } finally {
      flushing.current = false;
      setPending(pendingCount(track.id));
    }
  }, [planId]);

  // 記録中だけ位置を取得する(画面を離れると止まる)。[Gate L5] 段階に応じて連続の取得と間隔をあけた取得を切り替える
  const activeId = active?.id;
  const activeStatus = active?.status;
  const activeRef = useRef<LocationTrack | undefined>(active);
  activeRef.current = active;
  useEffect(() => {
    const track = activeRef.current;
    if (!track || track.id !== activeId || activeStatus !== 'recording') return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('この端末・ブラウザでは位置を取得できません');
      return undefined;
    }
    const geo = navigator.geolocation;
    const st = statsFor(track);
    const keepsLocal = track.mode !== 'synced';
    lastPoint.current = keepsLocal ? (loadLocalPoints(track.id).slice(-1)[0] ?? null) : null;
    setCollected(keepsLocal ? loadLocalPoints(track.id).length : track.point_count);
    setPending(pendingCount(track.id));
    let motion: MotionState = emptyMotion();
    let batteryState: BatteryState | null = null;
    let current: TierSetting = decideTier({
      precision: track.precision, speedMps: null, stationaryMs: 0, battery: null, lowPowerManual,
    });
    let tierSince = Date.now();
    let watchId: number | null = null;
    let pollTimer: number | null = null;
    let lastExpectAt = Date.now();
    let stopped = false;

    const store = (p: TrackPoint) => {
      if (keepsLocal) {
        if (!appendLocalPoint(track.id, p)) setGeoError('端末に保存できませんでした(ストレージが使えません)');
      } else {
        addPending(track.id, p);
        setPending(pendingCount(track.id));
      }
      setCollected((n) => n + 1);
    };

    const onPosition = (pos: GeolocationPosition, manual = false) => {
      if (stopped) return;
      setGeoError(null);
      const p = toTrackPoint(pos);
      motion = addFix(motion, p);
      let kept = manual
        ? (p.accuracy_m === null || p.accuracy_m <= MAX_ACCURACY_M)
        : keepWithTier(lastPoint.current, p, current, MAX_ACCURACY_M);
      // [Gate V2] 保護エリアの中の位置は保存も送信もしない(件数だけ数える)
      if (kept && inProtectedZone(p, zonesRef.current)) {
        kept = false;
        setZoneSkipped((n) => n + 1);
      }
      st.fix(Date.parse(p.recorded_at), kept, manual);
      saveStatsSnapshot(track.id, st.snapshot());
      if (kept) {
        lastPoint.current = p;
        store(p);
      }
      retune(pos.coords.speed ?? null);
    };

    const onError = (err: GeolocationPositionError) => {
      setGeoError(err.code === err.PERMISSION_DENIED
        ? '位置情報の利用がブラウザで許可されていません。ブラウザの設定で許可してください'
        : '位置を取得できませんでした。電波の良い場所で待つか、精度を下げてください');
    };

    const clearCapture = () => {
      if (watchId !== null) geo.clearWatch(watchId);
      if (pollTimer !== null) window.clearInterval(pollTimer);
      watchId = null;
      pollTimer = null;
    };

    const apply = (setting: TierSetting) => {
      clearCapture();
      current = setting;
      setTier(setting);
      setCapturing(true, setting.label);
      if (setting.pollMs === null) {
        watchId = geo.watchPosition((pos) => onPosition(pos), onError, setting.options);
      } else {
        const once = () => {
          st.expect();
          geo.getCurrentPosition((pos) => onPosition(pos), onError, setting.options);
        };
        once();
        pollTimer = window.setInterval(once, setting.pollMs);
      }
    };

    const retune = (reportedSpeed: number | null) => {
      const next = decideTier({
        precision: track.precision, speedMps: currentSpeed(motion, reportedSpeed), stationaryMs: stationaryForMs(motion),
        battery: batteryState, lowPowerManual,
      });
      if (next.tier !== current.tier) {
        st.addTierTime(current.tier, Date.now() - tierSince);
        tierSince = Date.now();
        apply(next);
      }
    };

    manualRecord.current = () => {
      geo.getCurrentPosition((pos) => onPosition(pos, true), onError,
        { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
    };

    apply(current);
    void readBattery().then((b) => {
      batteryState = b;
      setBattery(b);
      st.battery(b);
      retune(null);
    });
    const heartbeat = window.setInterval(() => {
      // 連続の取得では「取れるはずの回数」を時間から数える(欠測率のため)
      if (current.pollMs === null) {
        const n = Math.floor((Date.now() - lastExpectAt) / Math.max(current.minIntervalMs, 15_000));
        if (n > 0) {
          st.expect(n);
          lastExpectAt = Date.now();
        }
      }
      void readBattery().then((b) => {
        batteryState = b;
        setBattery(b);
        st.battery(b);
        retune(null);
      });
      void flush(track);
    }, 60_000);
    return () => {
      stopped = true;
      clearCapture();
      window.clearInterval(heartbeat);
      manualRecord.current = null;
      st.addTierTime(current.tier, Date.now() - tierSince);
      saveStatsSnapshot(track.id, st.snapshot());
      setCapturing(false);
      setTier(null);
      void flush(track);
      void reportSampling(track);
    };
    // 軌跡・状態・省電力の指定が変わった時だけやり直す(一覧の読み直しでは止めない)
  }, [activeId, activeStatus, lowPowerManual, flush, reportSampling, statsFor, setCapturing]);

  const run = async (fn: () => Promise<unknown>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      await fn();
      setMessage(done);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
      await load();
    }
  };

  if (!planId) return <div className="p-8 text-center text-ink-700">プランが選択されていません。</div>;

  const showDetail = async (t: LocationTrack) => {
    const localPoints = loadLocalPoints(t.id);
    if (t.mode === 'device_only') {
      setDetails((d) => ({ ...d, [t.id]: { points: localPoints, distance: totalDistanceM(localPoints), cells: [] } }));
      return;
    }
    try {
      const res = await getLocationTrack(planId, t.id);
      const points = t.mode === 'areas_only' ? localPoints : res.points;
      const distance = t.mode === 'areas_only' ? totalDistanceM(localPoints) : res.distance_m;
      setDetails((d) => ({ ...d, [t.id]: { points, distance, cells: res.cells } }));
    } catch (e) {
      setError(errorDetailMessage(e, '軌跡を読み込めませんでした'));
    }
  };

  const removeRange = (t: LocationTrack) => {
    const s = toIso(rangeStart);
    const e = toIso(rangeEnd);
    if (!s || !e || e < s) {
      setError('消す時間帯の開始と終了を入力してください(開始 ≦ 終了)');
      return;
    }
    run(async () => {
      const local = deleteLocalRange(t.id, s, e);
      if (t.mode !== 'device_only') await deleteTrackPoints(planId, t.id, s, e);
      else if (local === 0) throw new Error('none');
      setDetails((d) => {
        const next = { ...d };
        delete next[t.id];
        return next;
      });
    }, '指定した時間帯の位置を消しました', 'その時間帯に記録はありませんでした');
  };

  const removeTrack = (t: LocationTrack) => {
    if (!window.confirm('この軌跡を削除します。記録した位置はすべて消え、元に戻せません。よろしいですか?')) return;
    run(async () => {
      if (t.status !== 'stopped') await flush(t);
      await deleteLocationTrack(planId, t.id);
      clearLocalTrack(t.id);
      clearStatsSnapshot(t.id);
    }, '軌跡を削除しました', '軌跡を削除できませんでした');
  };

  const addCurrentZone = () => {
    if (!('geolocation' in navigator)) {
      setError('このブラウザは位置情報の取得に対応していません');
      return;
    }
    navigator.geolocation.getCurrentPosition((pos) => {
      const r = addZone({ label: zoneLabel || '保護エリア', latitude: pos.coords.latitude, longitude: pos.coords.longitude,
        radius_m: zoneRadius });
      setZones(r.zones);
      if (r.ok) {
        setZoneLabel('');
        setMessage(`保護エリア「${r.zones[r.zones.length - 1]!.label}」を追加しました(この端末だけ)`);
      } else {
        setError(r.reason ?? '保護エリアを追加できませんでした');
      }
    }, () => setError('位置を取得できませんでした。ブラウザで位置情報の利用を許可してください'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30_000 });
  };

  const saveTripMode = () => {
    if (!tripMode) return;
    run(async () => {
      const res = await putLocationSettings(planId, tripMode, settingRevision);
      setSettingRevision(res.revision);
      setTripMode(res.mode);
    }, tripMode === 'off' ? 'この旅行では位置を記録しない設定にしました' : '位置の扱いを保存しました',
    '位置の扱いを保存できませんでした');
  };

  const savedMode = data?.trip_mode ?? null;
  const canStart = !!data?.can_start && !!savedMode && savedMode !== 'off';

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900">位置の記録</h1>
      <p className="text-sm text-ink-700 mt-1">
        旅の記録のために、旅行の期間中だけ位置を記録できます。軌跡はあなただけが見られ、同行者(旅行の所有者を含む)には共有されません。
        記録はこの画面を開いている間だけ行います。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          <Card padding="md" className="mt-6">
            <section aria-label="この旅行での位置の扱い" className="space-y-3">
              <h2 className="font-semibold text-ink-900">この旅行での位置の扱い</h2>
              <p className="text-sm text-ink-900">
                {savedMode
                  ? `いまの設定: ${TRIP_MODE_OPTIONS.find((o) => o.value === savedMode)?.label.split('(')[0]}`
                  : 'まだ選んでいません(位置は記録していません)'}
              </p>
              <fieldset className="space-y-1">
                <legend className="text-sm text-ink-900">位置の扱い</legend>
                {TRIP_MODE_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-start gap-2 text-sm text-ink-900">
                    <input type="radio" name="trip-location-mode" value={o.value} className="mt-1"
                      checked={tripMode === o.value} onChange={() => setTripMode(o.value)} />
                    {o.label}
                  </label>
                ))}
              </fieldset>
              <Button size="sm" variant="outline" disabled={busy || !tripMode || tripMode === savedMode}
                onClick={saveTripMode}>位置の扱いを保存</Button>
            </section>
          </Card>

          <Card padding="md" className="mt-6">
            <section aria-label="保護エリア" className="space-y-3">
              <h2 className="font-semibold text-ink-900">保護エリア(自宅・職場など)</h2>
              <p className="text-sm text-ink-900">
                保護エリアの中で取れた位置は、どの記録の方法でも保存・送信しません。保護エリアはこの端末だけに保存し、サーバーへは送りません
                (ほかの端末では設定し直してください)。
              </p>
              {zones.length > 0 ? (
                <ul className="space-y-1">
                  {zones.map((z) => (
                    <li key={z.id} className="flex items-center gap-2 text-sm text-ink-900">
                      <span>{z.label}(半径{z.radius_m}m)</span>
                      <Button size="sm" variant="ghost" aria-label={`保護エリア「${z.label}」を削除`}
                        onClick={() => { setZones(removeZone(z.id)); setMessage(`保護エリア「${z.label}」を削除しました`); }}>
                        削除
                      </Button>
                    </li>
                  ))}
                </ul>
              ) : <p className="text-sm text-ink-700">保護エリアはありません。</p>}
              {zoneSkipped > 0 && (
                <p className="text-sm text-ink-900">保護エリアの中だったため記録しなかった位置: {zoneSkipped}件</p>
              )}
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-sm text-ink-900">名前
                  <input className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={zoneLabel} maxLength={40}
                    onChange={(e) => setZoneLabel(e.target.value)} placeholder="自宅" />
                </label>
                <label className="text-sm text-ink-900">半径
                  <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={zoneRadius}
                    onChange={(e) => setZoneRadius(Number(e.target.value))}>
                    {ZONE_RADII.map((r) => <option key={r} value={r}>{r}m</option>)}
                  </select>
                </label>
                <Button size="sm" variant="outline" disabled={busy} onClick={addCurrentZone}>今いる場所を保護エリアにする</Button>
              </div>
            </section>
          </Card>

          {active && (
            <Card padding="md" className="mt-6 border-2 border-blue-700">
              <section aria-label="記録中の軌跡" className="space-y-2">
                <p className="font-semibold text-blue-900" aria-live="polite">
                  {active.status === 'recording' ? '● 位置を記録しています' : '一時停止しています'}
                </p>
                <p className="text-sm text-ink-900">
                  {`保存先: ${MODE_LABEL[active.mode]}・精度: ${PRECISION[active.precision].label}・この画面で記録した点: ${collected}件`}
                  {active.mode === 'synced' ? `・未送信: ${pending}件` : ''}
                  {active.mode === 'areas_only' && syncedCells !== null ? `・送った区画: ${syncedCells}件` : ''}
                </p>
                {active.status === 'recording' && tier && (
                  <p className="text-sm text-ink-900" data-testid="sampling-tier">{`取得の間隔: ${tier.label}`}</p>
                )}
                {battery && <p className="text-sm text-ink-700">{`電池: ${pct(battery.level)}${battery.charging ? '(充電中)' : ''}`}</p>}
                <p className="text-sm text-ink-700">{`${showTime(active.auto_stop_at)}に自動で止まります(旅行の期間の終わり)`}</p>
                {geoError && <p className="text-sm text-red-800" role="alert">{geoError}</p>}
                <div className="flex flex-wrap gap-2">
                  {active.status === 'recording' ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      async () => {
                        await flush(active);
                        await reportSampling(active);
                        await changeLocationTrack(planId, active.id, 'pause', active.revision);
                      },
                      '記録を一時停止しました', '一時停止できませんでした')}>一時停止</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      () => changeLocationTrack(planId, active.id, 'resume', active.revision),
                      '記録を再開しました', '再開できませんでした')}>再開</Button>
                  )}
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => run(
                    async () => {
                      await flush(active);
                      await reportSampling(active);
                      await changeLocationTrack(planId, active.id, 'stop', active.revision);
                    },
                    '記録を止めました', '止められませんでした')}>記録を止める</Button>
                  {active.status === 'recording' && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => manualRecord.current?.()}>
                      今の場所を記録
                    </Button>
                  )}
                  {active.status === 'recording' && (
                    <Button size="sm" variant="outline" disabled={busy} aria-pressed={lowPowerManual}
                      onClick={() => setLowPowerManual((v) => !v)}>
                      {lowPowerManual ? '省電力を解除' : '省電力にする'}
                    </Button>
                  )}
                  {active.mode !== 'device_only' && (active.mode === 'areas_only' || pending > 0) && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => flush(active)}>今すぐ送る</Button>
                  )}
                </div>
              </section>
            </Card>
          )}

          {!active && (
            <Card padding="md" className="mt-6">
              <section aria-label="記録を始める" className="space-y-3">
                <h2 className="font-semibold text-ink-900">記録を始める</h2>
                {!data.location_consent && (
                  <div className="space-y-2">
                    <p className="text-sm text-ink-900">位置の記録には、位置情報の利用への同意が必要です(いつでも撤回でき、撤回すると記録はすぐ止まります)。</p>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      () => updateConsents({ location: true }), '位置情報の利用に同意しました', '同意を保存できませんでした')}>
                      位置情報の利用に同意する
                    </Button>
                  </div>
                )}
                {!savedMode && <p className="text-sm text-ink-900">先に「この旅行での位置の扱い」を選んで保存してください。</p>}
                {savedMode === 'off' && <p className="text-sm text-ink-900">この旅行は「記録しない」設定です。</p>}
                {!data.trip_period ? (
                  <p className="text-sm text-ink-900">旅行の日程が無いため記録できません。先にプランで日程を登録してください。</p>
                ) : (
                  <p className="text-sm text-ink-900">
                    {`記録できる期間: ${showTime(data.trip_period.start)} 〜 ${showTime(data.trip_period.end)}(前日から始められます)`}
                    {!data.in_trip_period && '。今は期間外です'}
                  </p>
                )}
                <label className="block text-sm text-ink-900">
                  精度
                  <select className="block mt-1 border rounded-sm px-2 py-1" value={precision} onChange={(e) => setPrecision(e.target.value as TrackPrecision)}>
                    {(['high', 'standard', 'low'] as TrackPrecision[]).map((p) => (
                      <option key={p} value={p}>{`${PRECISION[p].label}(${PRECISION[p].description})`}</option>
                    ))}
                  </select>
                </label>
                <p className="text-sm text-ink-700">
                  移動の速さ・止まっているか・電池の残量に合わせて、位置を取る頻度を自動で変えます。
                </p>
                <Button size="sm" variant="primary" disabled={busy || !canStart} onClick={() => run(
                  () => startLocationTrack(planId, null, precision), '位置の記録を始めました', '記録を始められませんでした')}>
                  記録を始める
                </Button>
              </section>
            </Card>
          )}

          <section aria-label="記録した軌跡" className="mt-6">
            <h2 className="font-semibold text-ink-900">記録した軌跡</h2>
            {data.tracks.length === 0 ? (
              <Card padding="lg" className="mt-2 text-center text-ink-700">まだ記録はありません。</Card>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.tracks.map((t) => {
                  const count = t.mode === 'synced' ? t.point_count : loadLocalPoints(t.id).length;
                  const detail = details[t.id];
                  const summary = samplingSummary(t.sampling);
                  return (
                    <li key={t.id}>
                      <Card padding="md" className="space-y-2">
                        <p className="text-sm text-ink-900">
                          {`${showTime(t.started_at)} 開始・${STATUS_LABEL[t.status]}・${MODE_LABEL[t.mode]}・${PRECISION[t.precision].label}・${count}件`}
                        </p>
                        {t.stopped_reason && <p className="text-sm text-ink-700">{`${REASON_LABEL[t.stopped_reason]}(${showTime(t.stopped_at)})`}</p>}
                        {summary && <p className="text-sm text-ink-700">{`記録の状態: ${summary}`}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => showDetail(t)}>軌跡を見る</Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => removeTrack(t)}>軌跡を削除</Button>
                        </div>
                        {detail && (
                          <div className="space-y-2">
                            <p className="text-sm text-ink-900">{`点${detail.points.length}件・移動距離 約${formatDistance(detail.distance)}`}</p>
                            {t.mode === 'areas_only' && (
                              <div>
                                <p className="text-sm text-ink-900">{`サーバーにあるのは訪問地域(区画)${detail.cells.length}件だけです(座標はこの端末だけ)`}</p>
                                <ul className="text-sm text-ink-900 list-disc pl-5">
                                  {detail.cells.map((c) => (
                                    <li key={c.key}>{`${CELL_STATE_LABEL[c.state]}・${Math.round(c.dwell_seconds / 60)}分・${showTime(c.first_at)}`}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                            <TrackSketch points={detail.points} label={`軌跡の略図(点${detail.points.length}件)`} />
                            <fieldset className="space-y-1">
                              <legend className="text-sm text-ink-900">時間帯を指定して消す</legend>
                              <div className="flex flex-wrap gap-2 items-end">
                                <label className="text-sm text-ink-900">開始
                                  <input type="datetime-local" className="block border rounded-sm px-2 py-1" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                                </label>
                                <label className="text-sm text-ink-900">終了
                                  <input type="datetime-local" className="block border rounded-sm px-2 py-1" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
                                </label>
                                <Button size="sm" variant="outline" disabled={busy} onClick={() => removeRange(t)}>この時間帯を消す</Button>
                              </div>
                            </fieldset>
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
};

export default LocationTrackPage;
