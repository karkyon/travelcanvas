/**
 * [Gate SpotInfo] 食事の場所の情報の表示(行きたい場所のカード・右の「選択中の予定」)。
 * ジャンルと名物を先頭に、予算(昼・夜)・予約・駐車場・支払い・特徴を短い印で並べる。入れていない項目は出さない。
 */
import React from 'react';
import { Car, Clock, CreditCard, Footprints, Sparkles, Users } from 'lucide-react';
import {
  FEATURES, MOODS, PARKING, PAYMENT, budgetLabel, genreLabel, RESERVATION, SMOKING, type DiningInfo,
} from './diningModel';

const lbl = (list: Array<[string, string]>, k: string) => list.find(([x]) => x === k)?.[1] ?? k;

const DiningSummary: React.FC<{ dining: DiningInfo | null | undefined; compact?: boolean }> = ({ dining, compact = false }) => {
  const d = dining ?? null;
  if (!d) return null;
  const lunch = budgetLabel(d.budget_lunch);
  const dinner = budgetLabel(d.budget_dinner);
  const facts: Array<[React.ReactNode, string]> = [];
  if (d.reservation) facts.push([<Sparkles key="r" size={13} aria-hidden="true" />, RESERVATION[d.reservation] ?? d.reservation]);
  if (d.parking) facts.push([<Car key="p" size={13} aria-hidden="true" />, `${PARKING[d.parking] ?? d.parking}${d.parking_note ? `(${d.parking_note})` : ''}`]);
  if (d.payment?.length) facts.push([<CreditCard key="c" size={13} aria-hidden="true" />, d.payment.map((k) => lbl(PAYMENT, k)).join('・')]);
  if (!compact && d.hours) facts.push([<Clock key="h" size={13} aria-hidden="true" />, `${d.hours}${d.closed ? ` / 定休 ${d.closed}` : ''}`]);
  if (!compact && d.seats) facts.push([<Users key="s" size={13} aria-hidden="true" />, `${d.seats} 席${d.private_room ? '・個室あり' : ''}`]);
  if (!compact && d.access) facts.push([<Footprints key="a" size={13} aria-hidden="true" />, d.access]);
  const tags = [
    ...(d.smoking ? [SMOKING[d.smoking] ?? d.smoking] : []),
    ...(compact && d.private_room ? ['個室あり'] : []),
    ...(d.features ?? []).map((k) => lbl(FEATURES, k)),
    ...(compact ? [] : (d.moods ?? []).map((k) => lbl(MOODS, k))),
  ];
  return (
    <div className="tc-dining-summary" data-testid="dining-summary">
      {d.genres?.length ? (
        <p className="tc-dining-genres">{d.genres.map((g) => <span key={g}>{genreLabel(g)}</span>)}</p>
      ) : null}
      {d.signature && <p className="tc-dining-signature"><b>名物</b>{d.signature}</p>}
      {(lunch || dinner) && (
        <p className="tc-dining-budget">
          {lunch && <span><b>昼</b>{lunch}</span>}
          {dinner && <span><b>夜</b>{dinner}</span>}
        </p>
      )}
      {facts.length > 0 && (
        <ul className="tc-dining-facts">
          {facts.map(([icon, text], i) => <li key={i}>{icon}<span>{text}</span></li>)}
        </ul>
      )}
      {tags.length > 0 && <p className="tc-dining-tags">{tags.slice(0, compact ? 5 : 20).map((t) => <span key={t}>{t}</span>)}</p>}
      {!compact && d.wait_note && <p className="tc-dining-wait">{`混み具合: ${d.wait_note}`}</p>}
    </div>
  );
};

export default DiningSummary;
