/**
 * [Gate HeaderPicker] 上の帯の「旅行を選ぶ」の一覧(開いた時に読み込む別の塊)。
 * 以前は押すと一覧を出さずに旅行の一覧の画面へ移っていた。ここで旅行を選ぶと、その旅行の旅程へ移る。
 * 一覧は自分が見られる旅行(GET /travel-plans/)。読めない時は旅行の一覧の画面への入口だけを出す(値を作らない)。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Check, List, Plus } from 'lucide-react';
import { travelAPI } from '../../services/api';
import type { TravelPlan } from '../../types';

interface Props {
  currentId: string | null;
  onClose: () => void;
}

type Row = Pick<TravelPlan, 'id' | 'title' | 'destination' | 'start_date' | 'end_date'>;

function md(d?: string | null): string | null {
  return d && /^\d{4}-\d{2}-\d{2}/.test(d) ? `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}` : null;
}

/** 日付の早い順(日付の無い旅行は後ろ)。同じなら題名の順 */
function sortTrips(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const x = a.start_date ?? '9999';
    const y = b.start_date ?? '9999';
    return x === y ? (a.title || '').localeCompare(b.title || '', 'ja') : x.localeCompare(y);
  });
}

const TripPickerMenu: React.FC<Props> = ({ currentId, onClose }) => {
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    let alive = true;
    travelAPI.getPlans()
      .then((res) => {
        if (!alive) return;
        const plans = res && res.success && Array.isArray(res.data) ? res.data : [];
        setRows(sortTrips(plans.map((p) => ({
          id: p.id, title: p.title, destination: p.destination, start_date: p.start_date, end_date: p.end_date,
        }))));
      })
      .catch(() => { if (alive) { setFailed(true); setRows([]); } });
    return () => { alive = false; };
  }, []);

  // 開いたら、今の旅行(無ければ最初の旅行)へフォーカスを移す。Esc で閉じる
  useEffect(() => {
    if (!rows || rows.length === 0) return;
    const el = list.current?.querySelector<HTMLButtonElement>('button[aria-current="true"]')
      ?? list.current?.querySelector<HTMLButtonElement>('button');
    el?.focus();
  }, [rows]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const move = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = Array.from(list.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    next?.focus();
  };

  const pick = (id: string) => {
    onClose();
    navigate(`/planner/${id}`);
  };

  return (
    <div className="tc-trip-menu" data-testid="trip-picker-menu" role="dialog" aria-label="旅行を選ぶ">
      {rows === null && <p className="tc-trip-menu-note" role="status">読み込み中…</p>}
      {failed && <p className="tc-trip-menu-note" role="alert">旅行の一覧を読み込めませんでした</p>}
      {rows !== null && !failed && rows.length === 0 && <p className="tc-trip-menu-note">まだ旅行がありません</p>}
      {rows && rows.length > 0 && (
        <ul ref={list} className="tc-trip-menu-list" aria-label="旅行" onKeyDown={move}>
          {rows.map((r) => {
            const range = [md(r.start_date), md(r.end_date)].filter(Boolean);
            const meta = [range.length ? Array.from(new Set(range)).join(' — ') : null, r.destination].filter(Boolean).join(' · ');
            const on = r.id === currentId;
            return (
              <li key={r.id}>
                <button type="button" className="tc-focus-ring" aria-current={on ? 'true' : undefined}
                  data-testid={`trip-picker-item-${r.id}`} onClick={() => pick(r.id)}>
                  <span className="tc-trip-menu-name">
                    <span>{r.title || '(題名なし)'}</span>
                    {meta && <small>{meta}</small>}
                  </span>
                  {on && <Check size={16} aria-label="開いている旅行" className="shrink-0" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <div className="tc-trip-menu-foot">
        <Link to="/planner" onClick={onClose} className="tc-focus-ring" data-testid="trip-picker-all">
          <List size={15} aria-hidden="true" />旅行の一覧へ
        </Link>
        <Link to="/planner?new=1" onClick={onClose} className="tc-focus-ring">
          <Plus size={15} aria-hidden="true" />旅行をつくる
        </Link>
      </div>
    </div>
  );
};

export default TripPickerMenu;
