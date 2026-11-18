/**
 * [Gate SpotMode] FR-060 スポットモードの中身(一覧・候補の詳しい所・次どこ？・周りを探す・方角で見る・みんなの印)。
 * スマホでは下から出るシート、タブレット横では右の欄に同じ物を出す(SpotModePage)。
 * 操作のボタンは 44px 以上・名前は見える文字を含める。距離・歩く時間は直線の目安。
 */
import React, { useState } from 'react';
import { Check, Compass, Footprints, MapPin, Navigation, Plus, Route, Search, Sparkles, Star, Undo2, X } from 'lucide-react';
import { safeExternalUrl } from '@/utils/safeNavigation';
import type { NearbyKind, NearbyResult, SpotItem, SpotSplit } from '@/services/api/types/spotAreas';
import {
  GENRE_META, MOODS, bearingDeg, directionWord, distanceM, formatDistance, hhmm, isDone, openAt, pointOf, walkMinutes,
  appleWalkUrl, googleWalkUrl, type Chain, type LatLng, type Mood, type Ranked,
} from './spotModel';

export const Pin: React.FC<{ n: number; item: SpotItem; size?: number }> = ({ n, item, size = 34 }) => {
  const g = GENRE_META[item.genre];
  const done = isDone(item);
  return (
    <span className={`tc-spot-dot${done ? ' is-done' : ''}`} style={{ '--pin': g.color, width: size, height: size } as React.CSSProperties}
      aria-hidden="true">{done ? <Check size={16} strokeWidth={3} /> : n}</span>
  );
};

const distText = (me: LatLng | null, i: SpotItem) => {
  const p = pointOf(i);
  if (!me || !p) return null;
  const m = distanceM(me, p);
  return `徒歩${walkMinutes(m)}分 ・ ${formatDistance(m)}`;
};

export const SpotList: React.FC<{
  items: SpotItem[]; numbers: Record<string, number>; me: LatLng | null; selectedId: string | null;
  canEdit: boolean; busy: string | null;
  onSelect: (id: string) => void; onGo: (id: string) => void; onVisit: (i: SpotItem) => void;
}> = ({ items, numbers, me, selectedId, canEdit, busy, onSelect, onGo, onVisit }) => (
  <ul className="tc-spot-list" aria-label="エリアの候補">
    {items.map((i) => {
      const sel = i.id === selectedId;
      const d = distText(me, i);
      return (
        <li key={i.id} className={`tc-spot-row${sel ? ' is-selected' : ''}${isDone(i) ? ' is-done' : ''}`} data-testid={`spot-row-${i.id}`}>
          <button type="button" className="tc-spot-row__main" onClick={() => onSelect(i.id)} aria-pressed={sel}
            aria-label={`${numbers[i.id]} ${i.title}${isDone(i) ? (i.skipped ? '(今日はやめる)' : '(訪問済み)') : ''}`}>
            <Pin n={numbers[i.id] ?? 0} item={i} />
            <span className="tc-spot-row__text">
              <span className="tc-spot-row__name">{i.title}
                {i.priority === 'want' && <span className="tc-spot-tag tc-spot-tag--want">行きたい</span>}
              </span>
              <span className="tc-spot-row__meta">
                {GENRE_META[i.genre].label} ・ 滞在 {i.stay_minutes}分{i.seats ? ' ・ 座れる' : ''}{i.fit === 'indoor' ? ' ・ 屋内' : ''}
                {i.wanted_by.length > 0 && ` ・ 行きたい印 ${i.wanted_by.length}`}
              </span>
            </span>
            <span className="tc-spot-row__dist">
              {i.visited_at ? `済み${i.visited_by ? `(${i.visited_by})` : ''}` : i.skipped ? 'やめた' : d ?? ''}
            </span>
          </button>
          {sel && !isDone(i) && (
            <div className="tc-spot-row__actions">
              <button type="button" className="tc-spot-btn tc-spot-btn--primary" onClick={() => onGo(i.id)}>
                <Route size={18} aria-hidden="true" />ここへ行く
              </button>
              {canEdit && (
                <button type="button" className="tc-spot-btn" disabled={busy === i.id} onClick={() => onVisit(i)}>
                  <Check size={18} aria-hidden="true" />着いた
                </button>
              )}
            </div>
          )}
        </li>
      );
    })}
  </ul>
);

export const SpotDetail: React.FC<{
  item: SpotItem; n: number; me: LatLng | null; nowMin: number; canEdit: boolean; busy: boolean; lineOn: boolean;
  near: Array<{ item: SpotItem; walk: number }>;
  onClose: () => void; onLine: () => void; onVisit: () => void; onSkip: () => void; onUndo: () => void; onWant: () => void;
  onPick: (id: string) => void;
}> = ({ item, n, me, nowMin, canEdit, busy, lineOn, near, onClose, onLine, onVisit, onSkip, onUndo, onWant, onPick }) => {
  const p = pointOf(item);
  const m = me && p ? distanceM(me, p) : null;
  const walk = m != null ? walkMinutes(m) : null;
  const open = openAt(item.hours_today, nowMin);
  const g = GENRE_META[item.genre];
  return (
    <section className="tc-spot-detail" aria-labelledby="spot-detail-title">
      <div className="tc-spot-detail__head">
        <Pin n={n} item={item} size={40} />
        <div className="tc-spot-detail__titles">
          <h2 id="spot-detail-title" className="tc-spot-serif">{item.title}</h2>
          <div className="tc-spot-tags">
            <span className="tc-spot-tag" style={{ '--tag': g.color } as React.CSSProperties}>{g.label}</span>
            {item.priority === 'want' && <span className="tc-spot-tag tc-spot-tag--want"><Star size={12} aria-hidden="true" />行きたい</span>}
            {item.wanted_by.length > 0 && <span className="tc-spot-tag">行きたい印: {item.wanted_by.join('・')}</span>}
            <span className="tc-spot-tag">滞在の目安 {item.stay_minutes}分</span>
          </div>
        </div>
        <button type="button" className="tc-spot-icon" onClick={onClose} aria-label="候補を閉じる"><X size={20} /></button>
      </div>
      <div className="tc-spot-stats">
        <div><span>歩いて</span><b>{walk != null ? `${walk}分` : '—'}</b></div>
        <div><span>きょり</span><b>{m != null ? formatDistance(m) : '—'}</b></div>
        <div><span>着く頃</span><b>{walk != null ? hhmm(nowMin + walk) : '—'}</b></div>
      </div>
      {!me && <p className="tc-spot-note">「現在地」を押すと、歩く時間と方角を出します。</p>}
      {me && p && m != null && <p className="tc-spot-note">{directionWord(bearingDeg(me, p))}の方へ {formatDistance(m)}(直線の目安。道順ではありません)</p>}
      {item.note && <p className="tc-spot-text">メモ: {item.note}</p>}
      {item.hours_today && (
        <p className="tc-spot-note">
          {open === true ? '営業中' : open === false ? '営業時間外' : '営業時間は不明'} ・ {item.hours_today.summary}
          (保存した情報。当日は店頭で確かめてください)
        </p>
      )}
      {item.visited_at && <p className="tc-spot-done"><Check size={16} aria-hidden="true" />着きました{item.visited_by ? `(${item.visited_by})` : ''}</p>}
      {item.skipped && <p className="tc-spot-note">今日はやめる にしました</p>}
      <div className="tc-spot-grid2">
        {p && (
          <button type="button" className="tc-spot-btn tc-spot-btn--primary" onClick={onLine} aria-pressed={lineOn} disabled={!me}>
            <Route size={18} aria-hidden="true" />{lineOn ? '線を消す' : '道順の目安を出す'}
          </button>
        )}
        {p && (
          <a className="tc-spot-btn" href={safeExternalUrl(googleWalkUrl(p)) ?? undefined} target="_blank" rel="noopener noreferrer">
            <Navigation size={18} aria-hidden="true" />Google マップで開く
          </a>
        )}
        {p && (
          <a className="tc-spot-btn" href={safeExternalUrl(appleWalkUrl(p)) ?? undefined} target="_blank" rel="noopener noreferrer">
            <MapPin size={18} aria-hidden="true" />Apple マップで開く
          </a>
        )}
        <button type="button" className="tc-spot-btn" onClick={onWant} aria-pressed={item.wanted_by_me}>
          <Star size={18} aria-hidden="true" />{item.wanted_by_me ? '行きたい印を外す' : '行きたい印を付ける'}
        </button>
        {canEdit && !isDone(item) && (
          <>
            <button type="button" className="tc-spot-btn tc-spot-btn--accent" onClick={onVisit} disabled={busy}>
              <Check size={18} aria-hidden="true" />着いた(印)
            </button>
            <button type="button" className="tc-spot-btn" onClick={onSkip} disabled={busy}>今日はやめる</button>
          </>
        )}
        {canEdit && isDone(item) && (
          <button type="button" className="tc-spot-btn" onClick={onUndo} disabled={busy}><Undo2 size={18} aria-hidden="true" />取り消す</button>
        )}
      </div>
      {near.length > 0 && (
        <div className="tc-spot-near">
          ここから近い候補:
          {near.map((x) => (
            <button key={x.item.id} type="button" className="tc-spot-link" onClick={() => onPick(x.item.id)}>
              {x.item.title} 徒歩{x.walk}分
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export const NextPick: React.FC<{
  ranked: Ranked[]; numbers: Record<string, number>; moods: Mood[]; chain: Chain | null; me: LatLng | null;
  onMood: (m: Mood) => void; onGo: (id: string) => void; onChain: () => void; chainOn: boolean;
}> = ({ ranked, numbers, moods, chain, me, onMood, onGo, onChain, chainOn }) => (
  <section className="tc-spot-next" aria-labelledby="spot-next-title">
    <h2 id="spot-next-title" className="tc-spot-serif">次どこ行く？</h2>
    <p className="tc-spot-note">いまの気分は？(いくつでも)</p>
    <div className="tc-spot-chips" role="group" aria-label="いまの気分">
      {MOODS.map((m) => (
        <button key={m.key} type="button" className="tc-spot-chip" aria-pressed={moods.includes(m.key)} onClick={() => onMood(m.key)}>
          {m.label}
        </button>
      ))}
    </div>
    {!me && <p className="tc-spot-note">「現在地」を押すと、近さも入れて並べます。</p>}
    {ranked.length === 0 && <p className="tc-spot-note">まだ行っていない候補はありません。</p>}
    <ol className="tc-spot-rank">
      {ranked.slice(0, 3).map((r, k) => (
        <li key={r.item.id} className={k === 0 ? 'is-top' : ''}>
          <div className="tc-spot-rank__head">
            <span className="tc-spot-rank__no tc-spot-serif">{k + 1}</span>
            <Pin n={numbers[r.item.id] ?? 0} item={r.item} />
            <div className="tc-spot-rank__name">
              <b className="tc-spot-serif">{r.item.title}</b>
              <span>{GENRE_META[r.item.genre].label} ・ 滞在 {r.item.stay_minutes}分</span>
            </div>
            {r.walk != null && <b className="tc-spot-rank__walk">{r.walk}分</b>}
          </div>
          <div className="tc-spot-tags">{r.reasons.map((x) => <span key={x} className="tc-spot-tag tc-spot-tag--ok">{x}</span>)}</div>
          <button type="button" className="tc-spot-btn tc-spot-btn--primary" onClick={() => onGo(r.item.id)}>
            <Route size={18} aria-hidden="true" />ここへ行く
          </button>
        </li>
      ))}
    </ol>
    {chain && (
      <div className="tc-spot-chain">
        <h3><Footprints size={16} aria-hidden="true" />残り時間で回れる道順の案</h3>
        <p className="tc-spot-chain__order">{chain.order.map((i) => i.title).join(' → ')}</p>
        <p className="tc-spot-note">
          歩き {chain.walk}分 + 滞在 {chain.stay}分 ・ {hhmm(chain.arrive)} に{chain.spare != null ? `集合場所(${chain.spare}分の余裕)` : '回り終わる'}
        </p>
        <button type="button" className="tc-spot-btn" onClick={onChain} aria-pressed={chainOn}>{chainOn ? '地図の線を消す' : 'この順で地図に出す'}</button>
      </div>
    )}
    <p className="tc-spot-fine">並べ方: 気分の条件・近さ・行きたい印・営業時間・残り時間で並べています(AI は使っていません)。</p>
  </section>
);

const KINDS: Array<{ key: NearbyKind; label: string }> = [
  { key: 'toilet', label: 'トイレ' }, { key: 'rest', label: '座れる所' }, { key: 'cafe', label: 'カフェ' },
  { key: 'sweets', label: '甘いもの' }, { key: 'food', label: '食べ歩き' }, { key: 'souvenir', label: 'お土産' },
  { key: 'locker', label: 'コインロッカー' }, { key: 'all', label: 'なんでも' },
];

export const NearbyPanel: React.FC<{
  me: LatLng | null; canEdit: boolean; busy: boolean; results: NearbyResult[] | null; message: string | null;
  added: Set<string>;
  onSearch: (q: { kind: NearbyKind; radius: number; withinArea: boolean; query: string }) => void;
  onAdd: (r: NearbyResult) => void; onLocate: () => void;
}> = ({ me, canEdit, busy, results, message, added, onSearch, onAdd, onLocate }) => {
  const [kind, setKind] = useState<NearbyKind>('all');
  const [radius, setRadius] = useState(500);
  const [withinArea, setWithinArea] = useState(false);
  const [query, setQuery] = useState('');
  const go = (k: NearbyKind = kind) => onSearch({ kind: k, radius, withinArea, query: query.trim() });
  return (
    <section className="tc-spot-nearby" aria-labelledby="spot-nearby-title">
      <h2 id="spot-nearby-title" className="tc-spot-serif">周りを探す</h2>
      {!me ? (
        <div className="tc-spot-note">
          今いる場所が要ります。<button type="button" className="tc-spot-btn" onClick={onLocate}>現在地を使う</button>
        </div>
      ) : (
        <form className="tc-spot-nearby__form" onSubmit={(e) => { e.preventDefault(); go(); }}>
          <label htmlFor="spot-q" className="tc-spot-sr">探す言葉</label>
          <div className="tc-spot-search"><Search size={18} aria-hidden="true" />
            <input id="spot-q" value={query} maxLength={60} placeholder="例: 甘いもの" onChange={(e) => setQuery(e.target.value)} />
            <button type="submit" className="tc-spot-btn tc-spot-btn--primary" disabled={busy}>探す</button>
          </div>
          <p className="tc-spot-fine" data-testid="spot-nearby-privacy">
            探すと、今いる場所の座標を場所の検索サービスへ送ります(保存はしません)。メンバーには送りません。
          </p>
          <div className="tc-spot-chips" role="group" aria-label="すぐ探す">
            {KINDS.map((k) => (
              <button key={k.key} type="button" className="tc-spot-chip" aria-pressed={kind === k.key} disabled={busy}
                onClick={() => { setKind(k.key); go(k.key); }}>{k.label}</button>
            ))}
          </div>
          <div className="tc-spot-chips" role="group" aria-label="探す範囲">
            {[300, 500, 1000].map((r) => (
              <button key={r} type="button" className="tc-spot-chip" aria-pressed={radius === r && !withinArea}
                onClick={() => { setRadius(r); setWithinArea(false); }}>{r < 1000 ? `${r}m` : '1km'}</button>
            ))}
            <button type="button" className="tc-spot-chip" aria-pressed={withinArea} onClick={() => setWithinArea(!withinArea)}>エリア内だけ</button>
          </div>
        </form>
      )}
      {message && <p className="tc-spot-note" role="status">{message}</p>}
      {results && (
        <ul className="tc-spot-list" aria-label="見つかった場所">
          {results.map((r) => {
            const key = `${r.name}|${r.latitude}`;
            const isAdded = r.in_area || added.has(key);
            return (
              <li key={key} className="tc-spot-row">
                <div className="tc-spot-row__main tc-spot-row__main--static">
                  <span className="tc-spot-dot" style={{ '--pin': GENRE_META[r.genre].color } as React.CSSProperties} aria-hidden="true">
                    <Compass size={16} />
                  </span>
                  <span className="tc-spot-row__text">
                    <span className="tc-spot-row__name">{r.name}</span>
                    <span className="tc-spot-row__meta">{r.genre_label} ・ 徒歩{r.walk_minutes}分 {formatDistance(r.distance_m)}{r.fit === 'indoor' ? ' ・ 屋内' : ''}</span>
                  </span>
                </div>
                {canEdit && (
                  <button type="button" className="tc-spot-btn" disabled={busy || isAdded} onClick={() => onAdd(r)}
                    aria-label={isAdded ? `${r.name}は候補にあります` : `${r.name}を候補に足す`}>
                    {isAdded ? <><Check size={16} aria-hidden="true" />候補にあり</> : <><Plus size={16} aria-hidden="true" />候補に</>}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="tc-spot-fine">
        場所の検索の利用枠を押した時に 1 回使います。今いる場所は探すのに使うだけで、保存しません。「候補に」で同行者の候補にも出ます。
        営業時間・混み具合は確かではありません。
      </p>
    </section>
  );
};

/** 地図の代わりに方角と距離で見る(圏外・地図が出ない時・読み上げで使う時) */
export const CompassList: React.FC<{ items: SpotItem[]; numbers: Record<string, number>; me: LatLng | null;
  onSelect: (id: string) => void; }> = ({ items, numbers, me, onSelect }) => (
  <div className="tc-spot-compass">
    {!me && <p className="tc-spot-note">「現在地」を押すと、方角と距離を出します(端末の中だけで計算します)。</p>}
    <ul className="tc-spot-list" aria-label="方角と距離">
      {items.map((i) => {
        const p = pointOf(i);
        const deg = me && p ? bearingDeg(me, p) : null;
        return (
          <li key={i.id} className="tc-spot-row">
            <button type="button" className="tc-spot-row__main" onClick={() => onSelect(i.id)}>
              <Pin n={numbers[i.id] ?? 0} item={i} />
              <span className="tc-spot-row__text"><span className="tc-spot-row__name">{i.title}</span>
                <span className="tc-spot-row__meta">{deg != null && p && me ? `${directionWord(deg)} ・ ${formatDistance(distanceM(me, p))}` : '方角は現在地が分かってから'}</span>
              </span>
              {deg != null && <span className="tc-spot-arrow" style={{ transform: `rotate(${deg}deg)` }} aria-hidden="true">↑</span>}
            </button>
          </li>
        );
      })}
    </ul>
  </div>
);

export const GroupMarks: React.FC<{ items: SpotItem[] }> = ({ items }) => {
  const visited = items.filter((i) => i.visited_at).sort((a, b) => (a.visited_at! < b.visited_at! ? -1 : 1));
  const wants = items.filter((i) => i.wanted_by.length && !isDone(i));
  if (!visited.length && !wants.length) return null;
  return (
    <section className="tc-spot-group" aria-labelledby="spot-group-title">
      <h3 id="spot-group-title"><Sparkles size={16} aria-hidden="true" />みんなの印(位置は共有しません)</h3>
      {visited.length > 0 && (
        <p>今日歩いた順: {visited.map((i) => `${i.title}${i.visited_by ? `(${i.visited_by})` : ''}`).join(' → ')}</p>
      )}
      {wants.length > 0 && <p>行きたい印: {wants.map((i) => `${i.title} ${i.wanted_by.length}`).join('・')}</p>}
    </section>
  );
};

/**
 * [Gate SpotMode-2] 別行動: 集合の場所・時刻だけを決めて分かれる。みんなの約束を一覧で見る。今いる場所は共有しない。
 */
export const SplitPanel: React.FC<{
  splits: SpotSplit[]; defaultTime: string | null; defaultLabel: string | null; busy: boolean;
  onSplit: (input: { meet_label?: string; meet_time?: string; note?: string }) => void; onRejoin: () => void;
}> = ({ splits, defaultTime, defaultLabel, busy, onSplit, onRejoin }) => {
  const mine = splits.find((s) => s.is_me) ?? null;
  const [open, setOpen] = useState(false);
  const [time, setTime] = useState(mine?.meet_time ?? defaultTime ?? '');
  const [label, setLabel] = useState(mine?.meet_label ?? defaultLabel ?? '');
  const [note, setNote] = useState(mine?.note ?? '');
  return (
    <section className="tc-spot-split" aria-labelledby="spot-split-title">
      <h3 id="spot-split-title">別行動と集合(位置は共有しません)</h3>
      {splits.length > 0 ? (
        <ul className="tc-spot-split__list" aria-label="別行動の約束">
          {splits.map((s) => (
            <li key={`${s.name}${s.meet_time}`}>
              <b>{s.is_me ? `${s.name}(自分)` : s.name}</b>: {s.meet_time}{s.meet_label ? ` に ${s.meet_label}` : ''} で合流
              {s.note ? ` ・ ${s.note}` : ''}
            </li>
          ))}
        </ul>
      ) : <p className="tc-spot-note">別行動の人はいません。</p>}
      {!open && (
        <div className="tc-spot-grid2">
          <button type="button" className="tc-spot-btn" onClick={() => setOpen(true)}>{mine ? '集合を変える' : '別行動にする'}</button>
          {mine && <button type="button" className="tc-spot-btn tc-spot-btn--primary" disabled={busy} onClick={onRejoin}>合流した</button>}
        </div>
      )}
      {open && (
        <form className="tc-spot-split__form" onSubmit={(e) => {
          e.preventDefault();
          onSplit({ ...(time ? { meet_time: time } : {}), ...(label.trim() ? { meet_label: label.trim() } : {}),
            ...(note.trim() ? { note: note.trim() } : {}) });
          setOpen(false);
        }}>
          <label htmlFor="split-time">集合の時刻</label>
          <input id="split-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          <label htmlFor="split-label">集合の場所</label>
          <input id="split-label" value={label} maxLength={100} placeholder="例: 駐車場" onChange={(e) => setLabel(e.target.value)} />
          <label htmlFor="split-note">ひとこと(任意)</label>
          <input id="split-note" value={note} maxLength={200} placeholder="例: 赤福で並びます" onChange={(e) => setNote(e.target.value)} />
          <div className="tc-spot-grid2">
            <button type="submit" className="tc-spot-btn tc-spot-btn--primary" disabled={busy}>みんなに知らせる</button>
            <button type="button" className="tc-spot-btn" onClick={() => setOpen(false)}>やめる</button>
          </div>
          <p className="tc-spot-fine">集合の約束だけをメンバーに知らせます。今いる場所は送りません。</p>
        </form>
      )}
    </section>
  );
};
