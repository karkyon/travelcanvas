/**
 * [Gate MemoryReel] ホームの「旅の記録と思い出」(S1 ホームの段・S5 選ぶ順)。
 *
 * - 左: 選んだ旅の写真が、ゆっくり寄る・引く動きで数秒ごとに流れる(MemoryReel)
 * - 右: 旅の道すじ(写真を撮った場所の順)・旅の数・「この旅を最初から見る」(全画面)・旅の記録・また行く計画
 * - 下: ほかの旅をめくる。並びはサーバーが決める(○年前の今日・この頃 > 同じ季節 > 最近)。札も同じ
 * 参考: Apple 写真のメモリー・Google フォトの思い出(上のカルーセル)・Polarsteps の Trip Reel・Facebook / Day One の「過去のこの日」
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import TripCover from '@/components/trip/TripCover';
import MemoryReel from '@/components/memories/reel/MemoryReel';
import ReelOverlay, { type ReelTrip } from '@/components/memories/reel/ReelOverlay';
import ReelRouteMap from '@/components/memories/reel/ReelRouteMap';
import { monthLabel, recapStats, replanQuery, type ReelFrame } from '@/components/memories/reel/reelModel';
import { useCoverPhoto } from '@/hooks/useCoverPhoto';
import { getMemoryReel, type MemoryReelData } from '@/services/api/memoryReel';
import type { DashboardHome, HomeTimelineTrip } from '@/services/api/types/g9';

/** ほかの旅のカード(表紙の写真があれば写真、無ければ行き先の色の絵)。押すとその旅を流す */
const ReelTripCard: React.FC<{ trip: HomeTimelineTrip; on: boolean; onPick: () => void }> = ({ trip: t, on, onPick }) => {
  const cover = useCoverPhoto(t.plan_id, t.cover);
  return (
    <button type="button" className="tc-focus-ring tc-home-reel-trip" aria-pressed={on} onClick={onPick}
      data-testid={`home-reel-trip-${t.plan_id}`}>
      <TripCover size="card" destination={t.destination ?? null} tripTitle={t.title} startDate={t.start_date}
        photo={cover.photo} onPhotoError={cover.onError} className="tc-cover--fixed tc-home-reel-trip-cover">
        {t.reel_badge && <span className="tc-reel-badge">{t.reel_badge}</span>}
        {on && <span className="tc-home-reel-now">再生中</span>}
      </TripCover>
      <span className="tc-home-reel-trip-body">
        <b>{t.title}</b>
        <small>{[monthLabel(t.start_date), `写真 ${t.photo_count}`].filter(Boolean).join(' · ')}</small>
      </span>
    </button>
  );
};

const MemoriesReelSection: React.FC<{ home: DashboardHome }> = ({ home }) => {
  const { timeline } = home.memories;
  const [selected, setSelected] = useState<string | null>(timeline[0]?.plan_id ?? null);
  const [reels, setReels] = useState<Record<string, MemoryReelData | 'error'>>({});
  const [frame, setFrame] = useState<ReelFrame | null>(null);
  const [full, setFull] = useState(false);

  useEffect(() => {
    if (!selected && timeline[0]) setSelected(timeline[0].plan_id);
  }, [selected, timeline]);

  useEffect(() => {
    if (!selected || reels[selected]) return undefined;
    let alive = true;
    getMemoryReel(selected)
      .then((d) => { if (alive) setReels((r) => ({ ...r, [selected]: d })); })
      .catch(() => { if (alive) setReels((r) => ({ ...r, [selected]: 'error' })); });
    return () => { alive = false; };
  }, [selected, reels]);

  const onFrame = useCallback((_i: number, f: ReelFrame) => setFrame(f), []);
  const trip = timeline.find((t) => t.plan_id === selected) ?? timeline[0] ?? null;
  const data = trip ? reels[trip.plan_id] : undefined;
  const reelTrips: ReelTrip[] = timeline.map((t) => ({ planId: t.plan_id, title: t.title, badge: t.reel_badge ?? null }));

  return (
    <section className="tc-card tc-home-memories tc-home-reel" aria-labelledby="home-memories" data-testid="home-memories">
      <div className="tc-section-row">
        <h2 id="home-memories" className="tc-section-title">旅の記録と思い出</h2>
        <span className="tc-home-mini tc-home-mini--visited">{`行った旅 ${home.shelves.visited}`}</span>
      </div>
      {!trip ? (
        <p className="mt-3 text-sm text-ink-700" data-testid="home-memories-empty">
          行った旅の写真・メモがここに並びます。旅行中は、旅行を開いた画面の「記録」から写真とメモを残せます。
        </p>
      ) : (
        <>
          <p className="tc-home-reel-lead">行った旅の写真が、ゆっくり動きながら数秒ごとに流れます。下の旅を選ぶと切り替わります。</p>
          <div className="tc-home-reel-main">
            <div className="tc-home-reel-stage">
              {data && data !== 'error' ? (
                <MemoryReel key={trip.plan_id} planId={trip.plan_id} data={data} variant="inline" badge={trip.reel_badge}
                  onExpand={() => setFull(true)} onFrameChange={onFrame} />
              ) : (
                <div className="tc-home-reel-wait">
                  <TripCover size="card" destination={trip.destination ?? null} tripTitle={trip.title} startDate={trip.start_date}
                    photo={null} className="tc-cover--fixed tc-reel-cover">{null}</TripCover>
                  <p role={data === 'error' ? 'alert' : 'status'}>
                    {data === 'error' ? '思い出を読み込めませんでした' : '思い出を読み込んでいます…'}
                  </p>
                </div>
              )}
            </div>
            <div className="tc-home-reel-side">
              <div className="tc-home-reel-route">
                <div className="tc-home-reel-route-head"><b>旅の道すじ</b><small>写真を撮った場所の順</small></div>
                {data && data !== 'error'
                  ? <ReelRouteMap data={data} frame={frame} />
                  : <div className="tc-reel-map is-empty"><p>読み込んでいます…</p></div>}
                <p className="tc-home-reel-here">
                  <b>{frame?.title ?? trip.title}</b>
                  {frame?.sub ? ` · ${frame.sub}` : ''}
                </p>
              </div>
              {data && data !== 'error' && (
                <dl className="tc-home-reel-stats">
                  {recapStats(data).slice(0, 3).map((s) => <div key={s.label}><dt>{s.label}</dt><dd>{s.value}</dd></div>)}
                </dl>
              )}
              <div className="tc-home-reel-actions">
                <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" onClick={() => setFull(true)}
                  data-testid="home-reel-play">この旅を最初から見る</button>
                <div>
                  <Link to={`/planner/${trip.plan_id}/memories`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">旅の記録を開く</Link>
                  <Link to={`/planner?new=1${replanQuery({ destination: trip.destination })}`} className="tc-focus-ring tc-mbtn tc-mbtn--sm">
                    また行く計画を作る
                  </Link>
                </div>
              </div>
            </div>
          </div>
          <div className="tc-home-reel-more">
            <div className="tc-home-reel-more-head">
              <b>ほかの旅をめくる</b>
              <small>○年前の今日・同じ季節の旅を先に並べます</small>
            </div>
            <ul className="tc-home-reel-trips" aria-label="行った旅(思い出の順)">
              {timeline.map((t) => (
                <li key={t.plan_id}>
                  <ReelTripCard trip={t} on={t.plan_id === trip.plan_id} onPick={() => { setSelected(t.plan_id); setFrame(null); }} />
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      {full && trip && (
        <ReelOverlay start={{ planId: trip.plan_id, title: trip.title, badge: trip.reel_badge ?? null }}
          trips={reelTrips} initial={data && data !== 'error' ? data : null} onClose={() => setFull(false)} />
      )}
    </section>
  );
};

export default MemoriesReelSection;
