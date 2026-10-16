/**
 * LocationTrackPage - 任意の位置軌跡(DOC-04 SC-43 Privacy & Location、DOC-14 §4.4 TRACK、FR-038)。
 *
 * [Gate P13] backend/app/api/v1/location_tracks.py の画面。
 * - 記録は明示的に開始する(既定はOFF)。位置情報の利用への同意と、旅行の期間内であることが必要
 * - 保存先: 「この端末だけ」(既定。座標をサーバーへ送らない)/「暗号化してサーバーへ」
 * - 記録中は常に表示し、一時停止・停止をすぐ押せる。記録はこの画面を開いている間だけ行う(ブラウザの制約)
 * - 軌跡は本人だけが見られる。任意の時間帯の点の削除・軌跡の削除ができる
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  changeLocationTrack, deleteLocationTrack, deleteTrackPoints, getLocationTrack, getLocationTracks, startLocationTrack,
  updateConsents, uploadTrackPoints,
} from '@/services/api';
import type { LocationTrack, LocationTrackList, TrackMode, TrackPoint, TrackPrecision } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  PRECISION, addPending, appendLocalPoint, clearLocalTrack, deleteLocalRange, loadLocalPoints, loadPending,
  pendingCount, removePending, shouldKeep, toTrackPoint, totalDistanceM,
} from '@/utils/trackRecorder';

const MODE_LABEL: Record<TrackMode, string> = { device_only: 'この端末だけ', synced: '暗号化してサーバーへ' };
const STATUS_LABEL = { recording: '記録中', paused: '一時停止中', stopped: '停止' } as const;
const REASON_LABEL = { user: '自分で停止', trip_ended: '旅行の期間が終わったため停止', consent_withdrawn: '同意を撤回したため停止' } as const;

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

/** 地図を使わない軌跡の略図(点を正規化して線で結ぶ)。内容は文章でも示す */
const TrackSketch: React.FC<{ points: TrackPoint[]; label: string }> = ({ points, label }) => {
  if (points.length < 2) return null;
  const lats = points.map((p) => p.latitude);
  const lngs = points.map((p) => p.longitude);
  const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  const span = Math.max(maxLat - minLat, maxLng - minLng) || 1;
  const xy = points.map((p) => `${(((p.longitude - minLng) / span) * 180 + 10).toFixed(1)},${(190 - ((p.latitude - minLat) / span) * 180).toFixed(1)}`);
  return (
    <svg viewBox="0 0 200 200" width="160" height="160" role="img" aria-label={label} className="border border-gray-200 rounded bg-gray-50">
      <polyline points={xy.join(' ')} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinejoin="round" />
    </svg>
  );
};

const LocationTrackPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [data, setData] = useState<LocationTrackList | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<TrackMode>('device_only');
  const [precision, setPrecision] = useState<TrackPrecision>('standard');
  const [busy, setBusy] = useState(false);
  const [collected, setCollected] = useState(0);
  const [pending, setPending] = useState(0);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [details, setDetails] = useState<Record<string, { points: TrackPoint[]; distance: number }>>({});
  const [rangeStart, setRangeStart] = useState('');
  const [rangeEnd, setRangeEnd] = useState('');
  const lastPoint = useRef<TrackPoint | null>(null);
  const flushing = useRef(false);

  const load = useCallback(async () => {
    if (!planId) return;
    try {
      setData(await getLocationTracks(planId));
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

  const flush = useCallback(async (track: LocationTrack) => {
    if (!planId || track.mode !== 'synced' || flushing.current) return;
    flushing.current = true;
    try {
      for (const batch of loadPending(track.id)) {
        const res = await uploadTrackPoints(planId, track.id, batch.batch_id, batch.points);
        removePending(track.id, batch.batch_id);
        if (res.status !== 'recording') break;
      }
    } catch (e) {
      // 送れなかったまとまりは端末に残し、同じbatch_idで送り直す
      setError(errorDetailMessage(e, '位置を送れませんでした。通信が戻ったら「今すぐ送る」を押してください'));
    } finally {
      flushing.current = false;
      setPending(pendingCount(track.id));
    }
  }, [planId]);

  // 記録中だけ位置を取得する(画面を離れると止まる)
  useEffect(() => {
    if (!active || active.status !== 'recording') return undefined;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGeoError('この端末・ブラウザでは位置を取得できません');
      return undefined;
    }
    const setting = PRECISION[active.precision];
    lastPoint.current = active.mode === 'device_only' ? (loadLocalPoints(active.id).slice(-1)[0] ?? null) : null;
    setCollected(active.mode === 'device_only' ? loadLocalPoints(active.id).length : active.point_count);
    setPending(pendingCount(active.id));
    const watchId = navigator.geolocation.watchPosition((pos) => {
      setGeoError(null);
      const p = toTrackPoint(pos);
      if (!shouldKeep(lastPoint.current, p, active.precision)) return;
      lastPoint.current = p;
      if (active.mode === 'device_only') {
        if (!appendLocalPoint(active.id, p)) setGeoError('端末に保存できませんでした(ストレージが使えません)');
      } else {
        addPending(active.id, p);
        setPending(pendingCount(active.id));
      }
      setCollected((n) => n + 1);
    }, (err) => {
      setGeoError(err.code === err.PERMISSION_DENIED
        ? '位置情報の利用がブラウザで許可されていません。ブラウザの設定で許可してください'
        : '位置を取得できませんでした。電波の良い場所で待つか、精度を下げてください');
    }, setting.options);
    const timer = window.setInterval(() => flush(active), 60_000);
    return () => {
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(timer);
      flush(active);
    };
  }, [active, flush]);

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

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  const showDetail = async (t: LocationTrack) => {
    if (t.mode === 'device_only') {
      const points = loadLocalPoints(t.id);
      setDetails((d) => ({ ...d, [t.id]: { points, distance: totalDistanceM(points) } }));
      return;
    }
    try {
      const res = await getLocationTrack(planId, t.id);
      setDetails((d) => ({ ...d, [t.id]: { points: res.points, distance: res.distance_m } }));
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
      if (t.mode === 'synced') await deleteTrackPoints(planId, t.id, s, e);
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
    }, '軌跡を削除しました', '軌跡を削除できませんでした');
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">位置の記録</h1>
      <p className="text-sm text-gray-700 mt-1">
        旅の記録のために、旅行の期間中だけ位置を記録できます。軌跡はあなただけが見られ、同行者(旅行の所有者を含む)には共有されません。
        記録はこの画面を開いている間だけ行います。
      </p>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

      {isLoading || !data ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : (
        <>
          {active && (
            <Card padding="md" className="mt-6 border-2 border-blue-700">
              <section aria-label="記録中の軌跡" className="space-y-2">
                <p className="font-semibold text-blue-900" aria-live="polite">
                  {active.status === 'recording' ? '● 位置を記録しています' : '一時停止しています'}
                </p>
                <p className="text-sm text-gray-800">
                  {`保存先: ${MODE_LABEL[active.mode]}・精度: ${PRECISION[active.precision].label}・この画面で記録した点: ${collected}件`}
                  {active.mode === 'synced' ? `・未送信: ${pending}件` : ''}
                </p>
                <p className="text-sm text-gray-700">{`${showTime(active.auto_stop_at)}に自動で止まります(旅行の期間の終わり)`}</p>
                {geoError && <p className="text-sm text-red-800" role="alert">{geoError}</p>}
                <div className="flex flex-wrap gap-2">
                  {active.status === 'recording' ? (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      async () => { await flush(active); await changeLocationTrack(planId, active.id, 'pause', active.revision); },
                      '記録を一時停止しました', '一時停止できませんでした')}>一時停止</Button>
                  ) : (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      () => changeLocationTrack(planId, active.id, 'resume', active.revision),
                      '記録を再開しました', '再開できませんでした')}>再開</Button>
                  )}
                  <Button size="sm" variant="danger" disabled={busy} onClick={() => run(
                    async () => { await flush(active); await changeLocationTrack(planId, active.id, 'stop', active.revision); },
                    '記録を止めました', '止められませんでした')}>記録を止める</Button>
                  {active.mode === 'synced' && pending > 0 && (
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => flush(active)}>今すぐ送る</Button>
                  )}
                </div>
              </section>
            </Card>
          )}

          {!active && (
            <Card padding="md" className="mt-6">
              <section aria-label="記録を始める" className="space-y-3">
                <h2 className="font-semibold text-gray-900">記録を始める</h2>
                {!data.location_consent && (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-800">位置の記録には、位置情報の利用への同意が必要です(いつでも撤回でき、撤回すると記録はすぐ止まります)。</p>
                    <Button size="sm" variant="outline" disabled={busy} onClick={() => run(
                      () => updateConsents({ location: true }), '位置情報の利用に同意しました', '同意を保存できませんでした')}>
                      位置情報の利用に同意する
                    </Button>
                  </div>
                )}
                {!data.trip_period ? (
                  <p className="text-sm text-gray-800">旅行の日程が無いため記録できません。先にプランで日程を登録してください。</p>
                ) : (
                  <p className="text-sm text-gray-800">
                    {`記録できる期間: ${showTime(data.trip_period.start)} 〜 ${showTime(data.trip_period.end)}(前日から始められます)`}
                    {!data.in_trip_period && '。今は期間外です'}
                  </p>
                )}
                <fieldset>
                  <legend className="text-sm text-gray-800">保存先</legend>
                  {(['device_only', 'synced'] as TrackMode[]).map((m) => (
                    <label key={m} className="flex items-center gap-2 text-sm text-gray-900">
                      <input type="radio" name="track-mode" value={m} checked={mode === m} onChange={() => setMode(m)} />
                      {m === 'device_only' ? 'この端末だけ(座標をサーバーへ送りません)' : '暗号化してサーバーへ(ほかの端末からも見られます)'}
                    </label>
                  ))}
                </fieldset>
                <label className="block text-sm text-gray-800">
                  精度
                  <select className="block mt-1 border rounded px-2 py-1" value={precision} onChange={(e) => setPrecision(e.target.value as TrackPrecision)}>
                    {(['high', 'standard', 'low'] as TrackPrecision[]).map((p) => (
                      <option key={p} value={p}>{`${PRECISION[p].label}(${PRECISION[p].description})`}</option>
                    ))}
                  </select>
                </label>
                <Button size="sm" variant="primary" disabled={busy || !data.can_start} onClick={() => run(
                  () => startLocationTrack(planId, mode, precision), '位置の記録を始めました', '記録を始められませんでした')}>
                  記録を始める
                </Button>
              </section>
            </Card>
          )}

          <section aria-label="記録した軌跡" className="mt-6">
            <h2 className="font-semibold text-gray-900">記録した軌跡</h2>
            {data.tracks.length === 0 ? (
              <Card padding="lg" className="mt-2 text-center text-gray-700">まだ記録はありません。</Card>
            ) : (
              <ul className="mt-2 space-y-2">
                {data.tracks.map((t) => {
                  const count = t.mode === 'device_only' ? loadLocalPoints(t.id).length : t.point_count;
                  const detail = details[t.id];
                  return (
                    <li key={t.id}>
                      <Card padding="md" className="space-y-2">
                        <p className="text-sm text-gray-900">
                          {`${showTime(t.started_at)} 開始・${STATUS_LABEL[t.status]}・${MODE_LABEL[t.mode]}・${PRECISION[t.precision].label}・${count}件`}
                        </p>
                        {t.stopped_reason && <p className="text-sm text-gray-700">{`${REASON_LABEL[t.stopped_reason]}(${showTime(t.stopped_at)})`}</p>}
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="outline" onClick={() => showDetail(t)}>軌跡を見る</Button>
                          <Button size="sm" variant="danger" disabled={busy} onClick={() => removeTrack(t)}>軌跡を削除</Button>
                        </div>
                        {detail && (
                          <div className="space-y-2">
                            <p className="text-sm text-gray-800">{`点${detail.points.length}件・移動距離 約${formatDistance(detail.distance)}`}</p>
                            <TrackSketch points={detail.points} label={`軌跡の略図(点${detail.points.length}件)`} />
                            <fieldset className="space-y-1">
                              <legend className="text-sm text-gray-800">時間帯を指定して消す</legend>
                              <div className="flex flex-wrap gap-2 items-end">
                                <label className="text-sm text-gray-800">開始
                                  <input type="datetime-local" className="block border rounded px-2 py-1" value={rangeStart} onChange={(e) => setRangeStart(e.target.value)} />
                                </label>
                                <label className="text-sm text-gray-800">終了
                                  <input type="datetime-local" className="block border rounded px-2 py-1" value={rangeEnd} onChange={(e) => setRangeEnd(e.target.value)} />
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
