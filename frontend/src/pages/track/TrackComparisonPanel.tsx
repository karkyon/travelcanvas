/**
 * [Gate Remaining-7] FR-054 予定の経路と GPS の軌跡の比べ(本人だけ・サーバーに保存した軌跡)。
 * 予定ごとに「いちばん近づいた距離・到達したか」、経路から外れた割合、寄り道(予定の外で 10 分以上)を出す。
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import type { TrackComparison } from '@/services/api/remaining6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const hm = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' }) : '—');
const meters = (m: number | null) => (m == null ? '—' : m >= 1000 ? `${(m / 1000).toFixed(1)}km` : `${m}m`);

const TrackComparisonPanel: React.FC<{ planId: string; trackId: string }> = ({ planId, trackId }) => {
  const [data, setData] = useState<TrackComparison | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async () => {
    setBusy(true); setErr(null);
    try { setData(await (await import('@/services/api/remaining6')).getTrackComparison(planId, trackId)); } catch (e) {
      setErr(errorDetailMessage(e, '予定と比べられませんでした'));
    } finally { setBusy(false); }
  };

  return (
    <section aria-label="予定の経路との比べ" className="space-y-2" data-testid="track-comparison">
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? '比べています…' : '予定の経路と比べる'}
      </Button>
      {err && <p role="alert" className="text-sm text-danger">{err}</p>}
      {data && (
        <div className="space-y-2 text-sm text-ink-900">
          {data.summary.planned_count === 0 ? (
            <p>軌跡のある日に、場所のある予定がありません。</p>
          ) : (
            <>
              <p data-testid="track-comparison-summary">
                {`予定 ${data.summary.planned_count}か所のうち ${data.summary.reached_count}か所に到達。`}
                {`予定の直線の距離 約${data.summary.planned_distance_km}km・実際の移動 約${data.summary.actual_distance_km}km。`}
                {data.summary.off_route_ratio != null
                  && `予定の線から${meters(data.summary.off_route_threshold_m)}以上離れた点 ${Math.round(data.summary.off_route_ratio * 100)}%`}
              </p>
              <table className="w-full text-left text-sm">
                <caption className="sr-only">予定ごとの到達</caption>
                <thead><tr><th scope="col">予定</th><th scope="col">予定の時刻</th><th scope="col">いちばん近づいた距離</th><th scope="col">その時刻</th><th scope="col">結果</th></tr></thead>
                <tbody>
                  {data.events.map((e) => (
                    <tr key={e.event_id}>
                      <td>{e.title}</td>
                      <td>{e.planned_time ?? '—'}</td>
                      <td>{meters(e.nearest_m)}</td>
                      <td>{hm(e.nearest_at)}</td>
                      <td>{e.reached ? '✓ 到達' : `× 未到達(半径${e.radius_m}m)`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          {data.unplanned_stops.length > 0 && (
            <div>
              <p className="font-medium">予定に無い所で留まった時間(寄り道)</p>
              <ul className="list-disc pl-5">
                {data.unplanned_stops.map((s) => (
                  <li key={s.from}>{`${hm(s.from)}〜${hm(s.to)}(${s.minutes}分)・おおよその位置 ${s.latitude}, ${s.longitude}`}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-xs text-ink-700">{`予定の経路は予定の場所を直線でつないだ線です(道の形ではありません)。比べた結果は保存しません(${data.algorithm_version})。`}</p>
        </div>
      )}
    </section>
  );
};

export default TrackComparisonPanel;
