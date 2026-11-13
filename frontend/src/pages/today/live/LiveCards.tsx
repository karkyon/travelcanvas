/**
 * [Gate TDay] 次の場所のチラ見せ・空模様の時刻の線。
 *
 * 画像: 予定に選んだ写真(自分・同行者の記録)を優先し、無ければ Wikipedia の記事の代表画像(出典の記事へのリンクつき)。
 * どちらも無ければ絵(場所の種類の模様)を出す。架空の写真は出さない。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CloudRain, Phone, Ticket as TicketIcon, Info } from 'lucide-react';
import type { TodayEvent } from '@/services/api';
import type { GuideEvent } from '@/services/api/travelDay';
import { getMemoryThumbnail } from '@/services/api/photoFeatures';
import { getAreaImages } from '@/services/api/tripIntent';
import { safeExternalUrl, safeTelHref } from '@/utils/safeNavigation';
import { formatTimeInZone } from '../todayModel';
import { hourAt, hoursLabel, localHm, type SkyHour } from './todayLive';

const areaCache = new Map<string, { url: string; page_url: string } | null>();

function useTeaserImage(planId: string, title: string, memoryId: string | null) {
  const [img, setImg] = useState<{ url: string; credit: string | null; href: string | null } | null>(null);
  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    setImg(null);
    (async () => {
      if (memoryId) {
        try {
          const blob = await getMemoryThumbnail(planId, memoryId);
          objectUrl = URL.createObjectURL(blob);
          if (alive) setImg({ url: objectUrl, credit: '自分たちの写真', href: null });
          return;
        } catch {
          // 写真を取れなければ代表画像へ
        }
      }
      const key = title.trim().slice(0, 40);
      if (!key) return;
      try {
        if (!areaCache.has(key)) {
          const got = await getAreaImages([key]);
          const v = got[key];
          areaCache.set(key, v ? { url: v.url, page_url: v.page_url } : null);
        }
        const hit = areaCache.get(key);
        if (alive && hit) setImg({ url: hit.url, credit: '画像: Wikipedia', href: hit.page_url });
      } catch {
        // 画像は無くてもよい
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [planId, title, memoryId]);
  return img;
}

const TeaserArt: React.FC<{ type: string }> = ({ type }) => (
  <svg className="tc-teaser__art" viewBox="0 0 400 168" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <rect width="400" height="168" fill="var(--tc-mist-200)" />
    <circle cx="320" cy="44" r="22" fill="var(--tc-sand-300)" />
    <path d="M0 108 Q100 86 200 102 T400 96 V168 H0Z" fill="var(--tc-accent-soft)" />
    <path d="M0 128 Q200 116 400 126 V168 H0Z" fill="var(--tc-mist-50)" />
    {type === 'dining' && <ellipse cx="200" cy="118" rx="54" ry="18" fill="var(--tc-sand-100)" />}
    {type === 'sightseeing' && <path d="M160 104 L200 76 L240 104Z" fill="var(--tc-sand-300)" />}
  </svg>
);

export const NextTeaser: React.FC<{
  planId: string; event: TodayEvent; guide: GuideEvent | undefined; hours: SkyHour[]; timeZone: string | null;
}> = ({ planId, event, guide, hours, timeZone }) => {
  const navigate = useNavigate();
  const img = useTeaserImage(planId, event.title, guide?.image_memory_id ?? null);
  const h = hoursLabel(guide?.hours?.status, guide?.hours?.minutes_to_close);
  const sky = hourAt(hours, localHm(event.start_at, timeZone));
  const stay = event.end_at || guide?.end_at
    ? Math.round((Date.parse((event.end_at ?? guide?.end_at)!) - Date.parse(event.start_at ?? '')) / 60_000) : null;
  return (
    <section className="tc-live-card tc-teaser" aria-labelledby="today-teaser-title" data-testid="today-teaser">
      <div className="tc-teaser__img">
        {img ? <img src={img.url} alt={`${event.title}の画像`} loading="lazy" /> : <TeaserArt type={event.event_type} />}
        {img?.credit && (img.href && safeExternalUrl(img.href)
          ? <a className="tc-teaser__credit" href={safeExternalUrl(img.href) ?? undefined} target="_blank" rel="noopener noreferrer">{img.credit}</a>
          : <span className="tc-teaser__credit">{img.credit}</span>)}
      </div>
      <div className="tc-teaser__body">
        <p className="tc-live-label">次の場所のチラ見せ</p>
        <h2 id="today-teaser-title" className="tc-lv-title">{event.title}</h2>
        <div className="tc-live-chips">
          {h && <span className={`tc-live-chip tc-live-chip--${h.tone}`}>{h.text}</span>}
          {sky && sky.probability != null && (
            <span className={`tc-live-chip ${sky.rainy ? 'tc-live-chip--info' : ''}`}>
              {`着く頃 ${sky.rainy ? '雨' : '雨は少ない'}(${sky.probability}%)`}
            </span>
          )}
          {event.has_ticket && <span className="tc-live-chip tc-live-chip--good">チケットあり</span>}
          {!event.has_ticket && event.reservation_id && <span className="tc-live-chip tc-live-chip--warn">予約 あり</span>}
          {stay != null && stay > 0 && stay < 24 * 60 && (
            <span className="tc-live-chip">{`滞在 ${stay}分${guide?.end_estimated ? '(目安)' : ''}`}</span>
          )}
        </div>
        {event.address && <p className="tc-live-muted" style={{ marginTop: 8 }}>{event.address}</p>}
        <div className="tc-live-actions">
          {guide?.place_id && (
            <button type="button" className="tc-focus-ring tc-mbtn"
              onClick={() => navigate(`/planner/${planId}/places/${guide.place_id}`)}>
              <Info size={16} aria-hidden="true" />詳しく
            </button>
          )}
          {guide?.phone && safeTelHref(guide.phone) && (
            <a className="tc-focus-ring tc-mbtn" href={safeTelHref(guide.phone) ?? undefined}>
              <Phone size={16} aria-hidden="true" />電話<span className="sr-only">{` ${guide.phone}`}</span>
            </a>
          )}
          {event.reservation_id && (
            <button type="button" className="tc-focus-ring tc-mbtn" onClick={() => navigate(`/planner/${planId}/reservations`)}>
              <TicketIcon size={16} aria-hidden="true" />予約を見る
            </button>
          )}
        </div>
      </div>
    </section>
  );
};

export const SkyLine: React.FC<{
  hours: SkyHour[]; events: TodayEvent[]; timeZone: string | null; nowMs: number; doneIds: Set<string>; nowId: string | null;
  rainIds: Set<string>; affectedTitle: string | null; hasRainVariant: boolean; onPlanB: () => void; source: string;
}> = ({ hours, events, timeZone, nowMs, doneIds, nowId, rainIds, affectedTitle, hasRainVariant, onPlanB, source }) => {
  const startHours = events.map((e) => Number((localHm(e.start_at, timeZone) ?? '').slice(0, 2))).filter((n) => !Number.isNaN(n));
  const from = Math.max(0, Math.min(8, ...(startHours.length ? startHours : [8])) - 1);
  const to = Math.min(23, Math.max(20, ...(startHours.length ? startHours : [20])) + 1);
  const shown = hours.filter((h) => h.hour >= from && h.hour <= to);
  if (shown.length === 0) return null;
  const nowHour = Number((localHm(new Date(nowMs).toISOString(), timeZone) ?? '0').slice(0, 2));
  const cols = { gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))` };
  const span = (to - from + 1) * 60;
  const pos = (iso: string | null) => {
    const hm = localHm(iso, timeZone);
    if (!hm) return null;
    return ((Number(hm.slice(0, 2)) - from) * 60 + Number(hm.slice(3, 5))) / span;
  };
  return (
    <section className="tc-live-card" aria-labelledby="today-sky-title" data-testid="today-sky">
      <div className="tc-live-row" style={{ justifyContent: 'space-between' }}>
        <h2 id="today-sky-title" className="tc-live-label">空模様の時刻の線</h2>
        <span className="tc-live-muted">{`1時間ごとの降水確率(${source})`}</span>
      </div>
      <div className="tc-sky__bars" style={cols} role="list" aria-label="1時間ごとの降水確率">
        {shown.map((h) => (
          <div key={h.hour} role="listitem" className="tc-sky__bar" aria-label={`${h.hour}時 ${h.probability ?? '不明'}%${h.rainy ? ' 雨' : ''}`}
            data-rain={h.rainy ? 'true' : undefined} data-mid={!h.rainy && (h.probability ?? 0) >= 30 ? 'true' : undefined}
            data-now={h.hour === nowHour ? 'true' : undefined}
            style={{ height: `${Math.max(5, h.probability ?? 0)}%` }} />
        ))}
      </div>
      <div className="tc-sky__hours" style={cols} aria-hidden="true">
        {shown.map((h) => <span key={h.hour}>{h.hour}</span>)}
      </div>
      <div className="tc-sky__events" aria-hidden="true">
        {events.map((e, i) => {
          const s = pos(e.start_at);
          if (s == null) return null;
          const nextStart = events[i + 1]?.start_at ?? null;
          const end = pos(e.end_at) ?? (nextStart ? pos(nextStart) : null) ?? Math.min(1, s + 60 / span);
          return (
            <span key={e.id} className="tc-sky__event" title={e.title}
              data-state={e.id === nowId ? 'now' : doneIds.has(e.id) ? 'done' : undefined}
              data-rain={rainIds.has(e.id) ? 'true' : undefined}
              style={{ left: `${Math.max(0, s) * 100}%`, width: `${Math.max(1, (end - s) * 100 - 0.6)}%` }} />
          );
        })}
      </div>
      {affectedTitle && (
        <div className="tc-sky__notice" role="note">
          <CloudRain size={24} aria-hidden="true" />
          <p><b>{`${affectedTitle}(屋外)が雨の時間にかかります。`}</b>{hasRainVariant ? '雨の日の控えの案に切り替えられます。' : '屋内の案を作れます。'}</p>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={onPlanB}>プランBを見る</button>
        </div>
      )}
      <p className="tc-live-muted" style={{ margin: '8px 0 0' }}>{`今 ${formatTimeInZone(new Date(nowMs).toISOString(), timeZone)}・予定は下の帯`}</p>
    </section>
  );
};
