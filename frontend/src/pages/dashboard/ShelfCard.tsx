/**
 * [Gate ShelfCards] ホームの「旅行の一覧」のカード。
 *
 * どのカードも同じ大きさにする(表紙の高さを固定・旅行名は 1 行・中身の行の数を揃える・下の段はいつも一番下)。
 * 「新しい旅行を作る」も同じ大きさのカードにする。
 *
 * - 表紙: 写真(無ければ行き先の色の絵)。左上に状況の札(出発まで ○日 / ○日目 / 行った旅・年 / ○日間・旅行案)
 * - 本文: 旅行名(1 行)と「…」(見送りにする・もう一度計画する)、日付と泊数、予定・写真・共有の数
 * - 下の段: 状態の札(色だけに頼らず文字で)と、開く先(行った旅は「思い出を見る」)
 *
 * カード全体を押すと旅程を開く(旅行名のリンクをカード全体に広げる)。「…」と「思い出を見る」はその上に置く。
 */
import React, { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MoreHorizontal, Plus } from 'lucide-react';
import TripCover from '@/components/trip/TripCover';
import { useCoverPhoto } from '@/hooks/useCoverPhoto';
import type { DashboardTrip } from '@/services/api/types/g9';
import { ROLE_LABEL } from './dashboardModel';
import { shelfBadge, shelfChip, shelfDateLine, shelfStats } from './shelfModel';

interface CardProps {
  trip: DashboardTrip;
  busy: boolean;
  onChangeState: (t: DashboardTrip, state: 'cancelled' | 'active') => void;
}

/** 「…」の操作(見送りにする / もう一度計画する)。外を押す・Esc で閉じる */
const ShelfMenu: React.FC<CardProps> = ({ trip: t, busy, onChangeState }) => {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); btn.current?.focus(); } };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [open]);
  const next = t.shelf === 'cancelled' ? 'active' : 'cancelled';
  return (
    <div className="tc-shelf-menu" ref={box}>
      <button ref={btn} type="button" className="tc-focus-ring tc-shelf-more" aria-haspopup="menu" aria-expanded={open}
        aria-controls={open ? menuId : undefined} aria-label={`「${t.title}」の操作`} onClick={() => setOpen((v) => !v)}
        data-testid={`home-more-${t.id}`}>
        <MoreHorizontal size={18} aria-hidden="true" />
      </button>
      {open && (
        <ul id={menuId} role="menu" className="tc-shelf-pop" aria-label={`「${t.title}」の操作`}>
          <li role="none">
            <button type="button" role="menuitem" className="tc-focus-ring" disabled={busy} autoFocus
              onClick={() => { setOpen(false); onChangeState(t, next); }} data-testid={`home-state-${t.id}`}>
              {next === 'active' ? 'もう一度計画する' : '見送りにする'}
            </button>
          </li>
        </ul>
      )}
    </div>
  );
};

export const ShelfCard: React.FC<CardProps> = (props) => {
  const { trip: t } = props;
  const cover = useCoverPhoto(t.id, t.cover);
  const shared = t.role !== 'owner';
  const memories = t.shelf === 'visited';
  const cta = memories ? '思い出を見る' : t.shelf === 'planning' ? '旅程を開く' : '旅行を開く';
  return (
    <article className="tc-shelf-card" data-shelf={t.shelf} data-testid={`trip-card-${t.id}`}>
      <TripCover size="card" destination={t.destination} tripTitle={t.title} startDate={t.start_date}
        photo={cover.photo} onPhotoError={cover.onError} className="tc-cover--fixed tc-shelf-cover">
        <span className="tc-shelf-chip">{shelfChip(t)}</span>
        {shared && <span className="tc-shelf-chip tc-shelf-chip--role">{`共有 · ${ROLE_LABEL[t.role]}`}</span>}
      </TripCover>
      <div className="tc-shelf-body">
        <div className="tc-shelf-titlerow">
          <h3 className="tc-shelf-title" title={t.title}>
            <Link to={`/planner/${t.id}`} className="tc-shelf-open" aria-label={`${t.title}(${shelfBadge(t)}・${shelfDateLine(t)})を開く`}>
              {t.title}
            </Link>
          </h3>
          {t.can_edit && t.shelf !== 'visited' && <ShelfMenu {...props} />}
        </div>
        <p className="tc-shelf-date">{shelfDateLine(t)}</p>
        <ul className="tc-shelf-stats" aria-label="旅行の数">
          {shelfStats(t).map((s) => <li key={s}>{s}</li>)}
        </ul>
        <div className="tc-shelf-foot">
          <span className="tc-shelf-badge" data-shelf={t.shelf}>{shelfBadge(t)}</span>
          {memories ? (
            <Link to={`/planner/${t.id}/memories`} className="tc-focus-ring tc-shelf-cta tc-shelf-cta--link"
              aria-label={`「${t.title}」の思い出を見る`}>{`${cta} →`}</Link>
          ) : <span className="tc-shelf-cta" aria-hidden="true">{`${cta} →`}</span>}
        </div>
      </div>
    </article>
  );
};

/** 「新しい旅行を作る」(旅行のカードと同じ大きさ) */
export const ShelfAddCard: React.FC = () => (
  <Link to="/planner?new=1" className="tc-focus-ring tc-shelf-add" data-testid="home-shelf-add">
    <span className="tc-shelf-add-ic" aria-hidden="true"><Plus size={20} /></span>
    <b>新しい旅行を作る</b>
    <small>行き先が決まっていなくても<br />相談しながら始められます</small>
    <em>旅行を作成 →</em>
  </Link>
);
