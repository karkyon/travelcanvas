/**
 * [FR-062] 旅の記録の「また行きたい」(詳細設計 DD-2026-11-22-01 §6.1)。
 * 1. このエリアごと また行きたい 2. 行った場所(着いた順・♡) 3. 行けなかった場所(まとめて今度行きたいへ。候補箱は消さない)
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Heart, MapPin } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { getAgainCandidates, saveAgain } from '@/services/api/again';
import type { AgainCandidates, AgainItem } from '@/services/api/again';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const when = (iso: string | null): string => {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())} に着いた`;
};
const walked = (min: number | null) => (min ? `自由に歩いた ${Math.floor(min / 60) ? `${Math.floor(min / 60)}時間` : ''}${min % 60 ? `${min % 60}分` : ''}` : null);

const AgainPanel: React.FC<{ planId: string }> = ({ planId }) => {
  const [data, setData] = useState<AgainCandidates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pick, setPick] = useState<Set<string> | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await getAgainCandidates(planId));
      setError(null);
    } catch (e) {
      setError(errorDetailMessage(e, 'また行きたいの候補を取れませんでした'));
    }
  }, [planId]);
  useEffect(() => { void load(); }, [load]);

  const save = async (items: AgainItem[], done: string) => {
    if (busy || items.length === 0) return;
    setBusy(true);
    try {
      const r = await saveAgain(planId, items);
      setMsg(`${done}(新しく ${r.saved.length} 件・残してあった ${r.merged.length} 件)`);
      await load();
    } catch (e) {
      setError(errorDetailMessage(e, '残せませんでした。画面を開き直してください'));
    } finally {
      setBusy(false);
    }
  };

  if (error && !data) return <p role="alert" className="mt-4 text-sm text-red-800">{error}</p>;
  if (!data) return <p role="status" className="mt-4 text-sm text-ink-700">読み込み中…</p>;
  const empty = !data.areas.length && !data.places.length && !data.missed.length;

  return (
    <div className="mt-4 space-y-6" data-testid="again-panel">
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      {msg && <p role="status" className="text-sm text-green-900">{msg}</p>}
      {empty && <p className="tc-card p-4 text-ink-700">自分の行った記録(着いた印・訪問・写真の場所)がまだありません。</p>}

      {data.areas.length > 0 && (
        <section aria-labelledby="again-area">
          <h2 id="again-area" className="font-semibold text-ink-900">このエリアごと また行きたい</h2>
          {data.areas.map((a) => (
            <div key={a.key} className="tc-card mt-2 flex flex-wrap items-center justify-between gap-2 p-4">
              <p className="text-sm text-ink-900">
                <b>{`${a.title}(半径 ${a.radius_m}m)`}</b>
                {[walked(a.walked_min), `着いた ${a.visited_count} か所`].filter(Boolean).map((t) => <span key={t}>{` · ${t}`}</span>)}
              </p>
              <button type="button" className={`tc-focus-ring tc-mbtn min-h-11 ${a.saved_spot_id ? 'is-active' : ''}`} disabled={busy}
                aria-pressed={!!a.saved_spot_id} onClick={() => void save([{ key: a.key, kind: 'area', wish_kind: 'again' }], `「${a.title}」を残しました`)}>
                {a.saved_spot_id ? '★ 残してあります' : 'エリアを残す'}
              </button>
            </div>
          ))}
        </section>
      )}

      {data.places.length > 0 && (
        <section aria-labelledby="again-places">
          <h2 id="again-places" className="font-semibold text-ink-900">行った場所</h2>
          <ul className="mt-2 divide-y divide-cloud-100">
            {data.places.map((p) => {
              const on = p.saved_kind === 'again';
              return (
                <li key={p.key} className="flex items-center gap-3 py-2">
                  <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-cloud-100"><MapPin size={18} /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium text-ink-900">{p.name}</span>
                    <span className="block text-xs text-ink-700">{[when(p.visited_at), p.photo_count ? `写真 ${p.photo_count}` : null, p.genre]
                      .filter(Boolean).join(' · ')}</span>
                  </span>
                  <button type="button" aria-pressed={on} disabled={busy}
                    className={`tc-focus-ring tc-mbtn min-h-11 gap-1 ${on ? 'tc-mbtn--primary' : ''}`}
                    onClick={() => void save([{ key: p.key, kind: 'place', wish_kind: 'again' }], `「${p.name}」をまた行きたいに残しました`)}>
                    <Heart size={16} aria-hidden="true" fill={on ? 'currentColor' : 'none'} />
                    <span>{on ? 'また行きたい' : '♡ また行きたい'}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {data.missed.length > 0 && (
        <section aria-labelledby="again-missed">
          <h2 id="again-missed" className="font-semibold text-ink-900">{`行けなかった場所 ${data.missed.length} 件`}</h2>
          <p className="mt-1 text-sm text-ink-700">{data.missed.map((x) => x.title).join('・')}</p>
          <button type="button" className="tc-focus-ring tc-mbtn mt-2 min-h-11" disabled={busy}
            onClick={() => setPick(new Set(data.missed.map((x) => x.key)))}>まとめて今度行きたいへ</button>
        </section>
      )}

      <Modal isOpen={pick !== null} onClose={() => setPick(null)} title="今度行きたいへ移す">
        <p className="text-sm text-ink-700">外す場所のチェックを外してください。この旅行の候補箱の行は消しません。</p>
        <ul className="mt-2">
          {data.missed.map((x) => (
            <li key={x.key}>
              <label className="flex min-h-11 items-center gap-2">
                <input type="checkbox" checked={!!pick?.has(x.key)} onChange={(e) => setPick((s) => {
                  const n = new Set(s ?? []);
                  if (e.target.checked) n.add(x.key); else n.delete(x.key);
                  return n;
                })} />
                {x.title}
              </label>
            </li>
          ))}
        </ul>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => setPick(null)}>やめる</button>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11" disabled={!pick?.size || busy}
            onClick={() => { const keys = [...(pick ?? [])]; setPick(null);
              void save(keys.map((key) => ({ key, kind: 'missed', wish_kind: 'next' })), '行けなかった場所を今度行きたいへ移しました'); }}>
            {`${pick?.size ?? 0} 件を移す`}
          </button>
        </div>
      </Modal>
    </div>
  );
};

export default AgainPanel;
