/**
 * [Gate TimelineRedesign] 地図の上に重ねる欄(2026-11-12 のモック「画面全体の見直し」の地図)。
 * - 左上: 日付 · 地図 と凡例(予定・候補・道の経路・直線の目安)
 * - 右上: この日の旅程チェック(たためる)。値は画面にある照合・予約・区間から作る(mapCheckModel)
 * - 左下: 選んだ予定の 1 行(番号・名前・時刻・「旅程のカードへ」・ここまでの経路)。以前の右の欄の代わり
 * - 右下: 次の予定(旅行の当日だけ)
 * 移動の概算は地図の下の帯(PlanMap の tc-planmap-foot)。
 */
import React, { useState } from 'react';
import { CalendarCheck, ChevronDown, ChevronUp, ChevronRight, Car, X, Navigation, LocateFixed } from 'lucide-react';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { minutesText, type DayCheck } from './mapCheckModel';

export interface MapSelected {
  num?: number;
  title: string;
  sub: string;
  routeHref: string | null;
}

export interface MapNext {
  time: string;
  title: string;
  minutes: number;
  routeHref: string | null;
}

interface Props {
  dateLabel: string;
  check: DayCheck | null;
  budget: number | null;
  cost: number;
  selected: MapSelected | null;
  onOpenCard: () => void;
  onClearSelected: () => void;
  next: MapNext | null;
  autoDetect: boolean;
  onToggleAutoDetect: () => void;
}

const yen = (n: number) => `¥${Math.round(n).toLocaleString()}`;

const MapOverlays: React.FC<Props> = ({ dateLabel, check, budget, cost, selected, onOpenCard, onClearSelected, next, autoDetect, onToggleAutoDetect }) => {
  const [open, setOpen] = useState(true);
  const pace = check && check.late.length === 0;
  return (
    <>
      <div className="tc-mapov tc-mapov-chip" data-testid="map-chip">
        <span className="tc-mapov-date">{dateLabel} · 地図</span>
        <span className="tc-mapov-legend"><i className="is-plan" aria-hidden="true" />予定</span>
        <span className="tc-mapov-legend"><i className="is-cand" aria-hidden="true" />候補</span>
        <span className="tc-mapov-legend"><i className="is-road" aria-hidden="true" />道の経路</span>
        <span className="tc-mapov-legend"><i className="is-straight" aria-hidden="true" />直線(目安)</span>
      </div>

      {check && (
        <section className="tc-mapov tc-mapov-check" aria-label="この日の旅程チェック" data-testid="map-check">
          <h3>
            <CalendarCheck size={15} aria-hidden="true" />この日の旅程チェック
            <button type="button" className="tc-focus-ring tc-mapov-fold" aria-expanded={open}
              aria-label={open ? 'チェックをたたむ' : 'チェックを開く'} onClick={() => setOpen((v) => !v)}>
              {open ? <ChevronUp size={14} aria-hidden="true" /> : <ChevronDown size={14} aria-hidden="true" />}
            </button>
          </h3>
          <p className={`tc-mapov-pace${pace ? '' : ' is-warn'}`} data-testid="map-check-pace">
            {pace
              ? `✓ 無理のないペースです${check.freeMinutes !== null ? `(ゆとり ${minutesText(check.freeMinutes)})` : ''}`
              : `! 間に合わない区間があります(${check.late.join('・')})`}
          </p>
          {open && (
            <ul className="tc-mapov-list">
              <li>
                <span className={`tc-mapov-mark${check.hoursProblems.length ? ' is-warn' : ''}`} aria-hidden="true">{check.hoursProblems.length ? '!' : '✓'}</span>
                <span><b>営業時間</b>{check.hoursProblems.length
                  ? ` 合わない・要確認 ${check.hoursProblems.length}件(${check.hoursProblems.join('・')})`
                  : check.hoursGood > 0 ? ` ${check.hoursGood}件とも時間内` : ' 照合した予定はまだありません'}</span>
              </li>
              <li>
                <span className={`tc-mapov-mark${check.unlinked.length || check.issues.length ? ' is-warn' : ''}`} aria-hidden="true">
                  {check.unlinked.length || check.issues.length ? '!' : '✓'}
                </span>
                <span><b>予約</b>
                  {check.issues.length > 0 && ` 要確認 ${check.issues.length}件(${check.issues.join('・')})`}
                  {check.unlinked.length > 0 && ` つないでいない予約 ${check.unlinked.length}件(${check.unlinked.join('・')})`}
                  {check.issues.length === 0 && check.unlinked.length === 0 && (check.unbooked > 0 ? ` 未予約 ${check.unbooked}件` : ' 問題なし')}
                </span>
              </li>
              <li>
                <span className={`tc-mapov-mark${check.moveUnset || check.moveMismatch ? ' is-warn' : ''}`} aria-hidden="true">
                  {check.moveUnset || check.moveMismatch ? '!' : '✓'}
                </span>
                <span><b>移動</b>
                  {check.moveMismatch > 0 && ` 前の予定と合っていない区間 ${check.moveMismatch}`}
                  {check.moveUnset > 0 && ` 移動手段 未設定 ${check.moveUnset}区間`}
                  {!check.moveUnset && !check.moveMismatch && ' 前後のつながり OK'}
                </span>
              </li>
              {budget !== null && budget > 0 && (
                <li>
                  <span className={`tc-mapov-mark${cost > budget ? ' is-warn' : ''}`} aria-hidden="true">¥</span>
                  <span><b>費用</b>{` 予算 ${yen(budget)} のうち ${yen(cost)}`}</span>
                </li>
              )}
            </ul>
          )}
        </section>
      )}

      {selected && (
        <div className="tc-mapov tc-mapov-sel" role="status" data-testid="map-selected">
          {selected.num !== undefined && <span className="tc-mapov-num">{selected.num}</span>}
          <span className="tc-mapov-seltext"><b>{selected.title}</b><small>{selected.sub}</small></span>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={onOpenCard} data-testid="map-selected-card">
            <ChevronRight size={14} aria-hidden="true" />旅程のカードへ
          </button>
          {selected.routeHref && (
            <a className="tc-focus-ring tc-mbtn tc-mbtn--sm" href={safeExternalUrl(selected.routeHref) ?? undefined} target="_blank" rel="noopener noreferrer">
              <Car size={14} aria-hidden="true" />ここまでの経路<span className="sr-only">(Google マップを新しいタブで開く)</span>
            </a>
          )}
          <button type="button" className="tc-focus-ring tc-mapov-x" aria-label="選択を外す" onClick={onClearSelected}><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      {next && (
        <section className="tc-mapov tc-mapov-next" aria-label="次の予定" data-testid="map-next">
          <p className="tc-mapov-nexthead"><b>次の予定</b><span>旅行の当日だけ</span></p>
          <p className="tc-mapov-nexttitle">{`${next.time} ${next.title}`}</p>
          <p className="tc-mapov-nextmin">{`始まるまで 約${minutesText(next.minutes)}`}</p>
          <div className="tc-mapov-nextbtns">
            {next.routeHref && (
              <a className="tc-focus-ring tc-mbtn tc-mbtn--sm" href={safeExternalUrl(next.routeHref) ?? undefined} target="_blank" rel="noopener noreferrer">
                <Navigation size={14} aria-hidden="true" />ルートを見る<span className="sr-only">(Google マップを新しいタブで開く)</span>
              </a>
            )}
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" aria-pressed={autoDetect} onClick={onToggleAutoDetect}>
              <LocateFixed size={14} aria-hidden="true" />{autoDetect ? '自動検出をやめる' : '近くを自動検出'}
            </button>
          </div>
        </section>
      )}
    </>
  );
};

export default MapOverlays;
