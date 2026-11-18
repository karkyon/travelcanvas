/**
 * [Gate SpotMode] FR-060 予定の画面(当日)に出す「自由に歩くエリア」の札と、スポットモードを勧める知らせ(SC-49)。
 *
 * - 今日の日のエリアだけ。札から 1 タップでスポットモードへ(「予定 ⇄ スポット」の切り替え)
 * - 勧める: 近づいた(範囲 + 200m 以内。位置の許可が既にある時だけ端末の中で判定し、送らない)か、始まりの 10 分前〜終わり
 *   自動で切り替えない。「あとで」はこの旅行・このエリアでは今日の間出さない(sessionStorage)
 * 当日の画面と一緒に読む(小さい部品。地図は持たない)。
 */
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Map as MapIcon, Star } from 'lucide-react';
import { listSpotAreas } from '@/services/api/spotAreas';
import type { SpotArea } from '@/services/api/types/spotAreas';
import { areaCenter, nowIn, shouldSuggest, type LatLng } from '../../spot/spotModel';
import '@/styles/spot-mode.css';

const dismissKey = (areaId: string) => `tc-spot-later:${areaId}`;

const TodaySpotStrip: React.FC<{ planId: string; todayDate: string | null; timeZone: string | null; nowMs: number }> = ({
  planId, todayDate, timeZone, nowMs,
}) => {
  const [areas, setAreas] = useState<SpotArea[]>([]);
  const [me, setMe] = useState<LatLng | null>(null);
  const [later, setLater] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let alive = true;
    listSpotAreas(planId).then((l) => { if (alive) setAreas(l.areas); }).catch(() => undefined);
    return () => { alive = false; };
  }, [planId]);

  const today = areas.filter((a) => a.local_date && a.local_date === todayDate && a.items.length);
  const wantsLocation = today.some((a) => a.suggest_on_approach);
  useEffect(() => {
    if (!wantsLocation) return undefined;
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    let id: number | null = null;
    perms?.query({ name: 'geolocation' as PermissionName }).then((s) => {
      if (s.state !== 'granted' || !('geolocation' in navigator)) return;
      id = navigator.geolocation.watchPosition((p) => setMe([p.coords.latitude, p.coords.longitude]), () => undefined,
        { maximumAge: 60_000, timeout: 30_000 });
    }).catch(() => undefined);
    return () => { if (id != null) navigator.geolocation.clearWatch(id); };
  }, [wantsLocation]);

  if (!today.length) return null;
  const nowMin = nowIn(timeZone, nowMs).minutes;
  const isLater = (id: string) => later.has(id) || (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(dismissKey(id)) === '1');
  const prompt = today.map((a) => ({ a, why: isLater(a.id) ? null : shouldSuggest(a, nowMin, areaCenter(a), me) }))
    .find((x) => x.why);

  return (
    <div className="tc-spot-strip">
      {prompt && (
        <section className="tc-spot-prompt" aria-labelledby="spot-prompt-title">
          <div className="tc-spot-prompt__body">
            <span className="tc-spot-prompt__icon" aria-hidden="true"><MapIcon size={20} /></span>
            <div>
              <h2 id="spot-prompt-title">{prompt.why === 'near' ? `${prompt.a.title}に近づきました` : `そろそろ「${prompt.a.title}」の時間です`}</h2>
              <p>地図で候補を見ながら歩きますか？ 予定にはいつでも戻れます。</p>
            </div>
          </div>
          <div className="tc-spot-prompt__actions">
            <Link className="tc-spot-prompt__go" to={`/planner/${planId}/spot/${prompt.a.id}`}>切り替える</Link>
            <button type="button" className="tc-spot-prompt__later" onClick={() => {
              try { sessionStorage.setItem(dismissKey(prompt.a.id), '1'); } catch { /* 保存できなくても今は閉じる */ }
              setLater((s) => new Set(s).add(prompt.a.id));
            }}>あとで</button>
          </div>
          <p className="tc-spot-prompt__fine">現在地はこの端末の中だけで使い、送りません。</p>
        </section>
      )}
      {today.map((a) => {
        const wants = a.items.filter((i) => i.priority === 'want').length;
        return (
          <section key={a.id} className="tc-spot-card" aria-labelledby={`spot-card-${a.id}`}>
            <p className="tc-spot-card__eyebrow"><MapIcon size={14} aria-hidden="true" />自由に歩くエリア{a.start_time ? ` ・ ${a.start_time}〜${a.end_time ?? ''}` : ''}</p>
            <h2 id={`spot-card-${a.id}`} className="tc-spot-card__title">{a.title}</h2>
            <p className="tc-spot-card__text">順番は決めていません。候補 {a.items.length}件から、その時の天気・体調・気分で選びます。</p>
            <div className="tc-spot-card__tags">
              {wants > 0 && <span className="is-want"><Star size={12} aria-hidden="true" />行きたい {wants}</span>}
              <span>気分で {a.items.length - wants}</span>
              {a.meet_label && <span>集合 {a.meet_time ?? ''} {a.meet_label}</span>}
            </div>
            {a.splits.length > 0 && (
              <p className="tc-spot-card__text">別行動: {a.splits.map((s) => `${s.is_me ? '自分' : s.name} ${s.meet_time}${s.meet_label ? ` ${s.meet_label}` : ''}`).join('・')}</p>
            )}
            <Link className="tc-spot-card__go" to={`/planner/${planId}/spot/${a.id}`}><MapIcon size={18} aria-hidden="true" />スポットモードで歩く</Link>
          </section>
        );
      })}
    </div>
  );
};

export default TodaySpotStrip;
