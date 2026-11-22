/**
 * [FR-062] ♡ 今度行きたいに残す(どこからでも)。詳細設計 DD-2026-11-22-01 §5.2・§5.3。
 *
 * - 下から開くシート(高さ 85%)。閉じるボタン・背景・下へ払う・Esc で閉じる
 * - 今いる所の近く: 位置の許可があれば 1 回だけ取る(精度 100m 以内・3 秒まで)。周り 300m の候補を最大 8 件。行を押すとその場で保存
 * - ほかの入れ方: 名前で探す・写真・スクショ・URL・SNS・今の予定の場所(当日の時だけ)
 * - 通信できない時は端末に暗号化して溜め(pending_wishes)、つながった時に送る
 * - 保存の後、取り消しのできる知らせ(6 秒)。作った時は削除、既にあった時は元の値へ戻す
 */
import React, { Suspense, lazy, useCallback, useEffect, useRef, useState } from 'react';
import { X, MapPin, Search, Image as ImageIcon, Link2, CalendarCheck } from 'lucide-react';
import { nearbyCandidates } from '@/services/api/spotIntake';
import type { NearbyCandidate, WishKind, WishWhen } from '@/services/api/spotIntake';
import type { PlaceDraft, PlaceTab } from '@/components/search/PlaceFinder';
import type { WishSheetOptions } from './wishEvents';
import { POSITION_ACCURACY_M, POSITION_TIMEOUT_MS, saveWish } from './wishSave';

const PlaceFinder = lazy(() => import('@/components/search/PlaceFinder'));

type PosState = { kind: 'idle' } | { kind: 'asking' } | { kind: 'need_permission' } | { kind: 'denied' }
  | { kind: 'coarse' } | { kind: 'loading' } | { kind: 'ready'; rows: NearbyCandidate[] } | { kind: 'failed' };

async function permissionState(): Promise<PermissionState | 'unknown'> {
  try {
    const perms = (navigator as Navigator & { permissions?: Permissions }).permissions;
    if (!perms?.query) return 'unknown';
    return (await perms.query({ name: 'geolocation' as PermissionName })).state;
  } catch {
    return 'unknown';
  }
}

function getPositionOnce(): Promise<GeolocationPosition> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) { reject(new Error('no_geolocation')); return; }
    navigator.geolocation.getCurrentPosition(resolve, reject,
      { enableHighAccuracy: true, timeout: POSITION_TIMEOUT_MS, maximumAge: 60_000 });
  });
}

const OTHER: { tab: PlaceTab | 'current'; label: string; Icon: typeof Search }[] = [
  { tab: 'search', label: '名前で探す', Icon: Search },
  { tab: 'photo', label: '写真・スクショ', Icon: ImageIcon },
  { tab: 'url', label: 'URL・SNS', Icon: Link2 },
  { tab: 'current', label: '今の予定の場所', Icon: CalendarCheck },
];

interface Props { open: boolean; options: WishSheetOptions; onClose: () => void }

export const WishSheet: React.FC<Props> = ({ open, options, onClose }) => {
  const [kind, setKind] = useState<WishKind>(options.kind ?? 'next');
  const [note, setNote] = useState('');
  const [when, setWhen] = useState<WishWhen | null>(null);
  const [pos, setPos] = useState<PosState>({ kind: 'idle' });
  const [finder, setFinder] = useState<PlaceTab | null>(null);
  const [saving, setSaving] = useState(false);
  const dragFrom = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const locate = useCallback(async () => {
    setPos({ kind: 'loading' });
    try {
      const p = await getPositionOnce();
      if (p.coords.accuracy > POSITION_ACCURACY_M) { setPos({ kind: 'coarse' }); return; }
      const r = await nearbyCandidates(p.coords.latitude, p.coords.longitude);
      setPos({ kind: 'ready', rows: r.results });
    } catch (e) {
      const code = (e as GeolocationPositionError | null)?.code;
      setPos(code === 1 ? { kind: 'denied' } : { kind: 'failed' });
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setKind(options.kind ?? 'next');
    setNote('');
    setWhen(null);
    setFinder(null);
    setPos({ kind: 'asking' });
    let alive = true;
    void permissionState().then((st) => {
      if (!alive) return;
      if (st === 'granted') void locate();
      else setPos(st === 'denied' ? { kind: 'denied' } : { kind: 'need_permission' });
    });
    closeRef.current?.focus();
    return () => { alive = false; };
  }, [open, options, locate]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const save = async (d: { name: string; latitude?: number | null; longitude?: number | null; address?: string | null;
    genre?: string | null }) => {
    if (saving) return;
    setSaving(true);
    try {
      const r = await saveWish({ ...d, kind, note, when, sourceKind: options.sourceKind ?? 'quick', planId: options.planId });
      if (r) onClose();
    } finally {
      setSaving(false);
    }
  };

  const pickDraft = (d: PlaceDraft) => void save({ name: d.name, latitude: d.latitude, longitude: d.longitude,
    address: d.address, genre: d.category });

  return (
    <div className="fixed inset-0 z-[60]" data-testid="wish-sheet-root">
      <div className="absolute inset-0 bg-black/40" aria-hidden="true" data-testid="wish-sheet-backdrop" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="wish-sheet-title"
        className="absolute inset-x-0 bottom-0 h-[85vh] overflow-y-auto rounded-t-2xl bg-cloud-0 p-4 shadow-xl"
        onTouchStart={(e) => { dragFrom.current = e.touches[0]?.clientY ?? null; }}
        onTouchEnd={(e) => {
          const from = dragFrom.current;
          dragFrom.current = null;
          const to = e.changedTouches[0]?.clientY;
          if (from !== null && to !== undefined && to - from > 80) onClose();
        }}>
        <div className="mx-auto mb-2 h-1.5 w-10 rounded-full bg-cloud-200" aria-hidden="true" />
        <div className="flex items-center justify-between gap-2">
          <h2 id="wish-sheet-title" className="text-lg font-bold text-ink-900">今度行きたいに残す</h2>
          <button ref={closeRef} type="button" className="tc-focus-ring tc-mbtn min-h-11 min-w-11" aria-label="閉じる" onClick={onClose}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <div className="tc-list-tabs mt-3" role="radiogroup" aria-label="種類">
          {(['next', 'again'] as WishKind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k}
              className={`tc-focus-ring tc-pill min-h-11 ${kind === k ? 'is-active font-semibold' : ''}`} onClick={() => setKind(k)}>
              {k === 'next' ? '♡ 今度行きたい' : '★ また行きたい'}
            </button>
          ))}
        </div>

        {finder === null && (
          <>
            <section className="mt-4" aria-labelledby="wish-near-title">
              <h3 id="wish-near-title" className="flex items-center gap-1 font-semibold text-ink-900">
                <MapPin size={16} aria-hidden="true" />今いる所の近く
              </h3>
              {(pos.kind === 'asking' || pos.kind === 'loading') && <p className="mt-2 text-sm text-ink-600" role="status">近くを探しています…</p>}
              {(pos.kind === 'need_permission' || pos.kind === 'denied') && (
                <div className="mt-2 text-sm text-ink-700">
                  <p>近くの候補を出すには位置の許可が要ります</p>
                  {pos.kind === 'need_permission'
                    ? <button type="button" className="tc-focus-ring tc-mbtn mt-2 min-h-11" onClick={() => void locate()}>位置の許可</button>
                    : <p className="mt-1 text-ink-600">ブラウザの設定で位置を許可すると出せます。下のほかの入れ方でも残せます</p>}
                </div>
              )}
              {pos.kind === 'coarse' && <p className="mt-2 text-sm text-ink-700">位置が粗いため近くの候補を出せません。ほかの入れ方で残してください</p>}
              {pos.kind === 'failed' && (
                <p className="mt-2 text-sm text-ink-700">近くの候補を取れませんでした。
                  <button type="button" className="tc-focus-ring min-h-11 underline" onClick={() => void locate()}>もう一度</button>
                </p>
              )}
              {pos.kind === 'ready' && pos.rows.length === 0 && <p className="mt-2 text-sm text-ink-700">周り 300m に候補が見つかりませんでした</p>}
              {pos.kind === 'ready' && pos.rows.length > 0 && (
                <ul className="mt-2 divide-y divide-cloud-100" aria-label="近くの候補">
                  {pos.rows.map((r) => (
                    <li key={`${r.name}-${r.lat}-${r.lng}`}>
                      <button type="button" disabled={saving}
                        className="tc-focus-ring flex min-h-11 w-full items-center justify-between gap-2 py-2 text-left"
                        onClick={() => void save({ name: r.name, latitude: r.lat, longitude: r.lng, address: r.address, genre: r.genre })}>
                        <span><span className="font-medium text-ink-900">{r.name}</span>
                          {r.genre && <span className="ml-2 text-xs text-ink-600">{r.genre}</span>}</span>
                        <span className="text-sm text-ink-600">{r.distance_m}m</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-4" aria-labelledby="wish-other-title">
              <h3 id="wish-other-title" className="font-semibold text-ink-900">ほかの入れ方</h3>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {OTHER.filter((o) => o.tab !== 'current' || options.currentPlace).map(({ tab, label, Icon }) => (
                  <button key={tab} type="button" className="tc-focus-ring tc-mbtn min-h-11 justify-start gap-2"
                    onClick={() => {
                      if (tab === 'current') { if (options.currentPlace) pickDraft(options.currentPlace); }
                      else setFinder(tab);
                    }}>
                    <Icon size={16} aria-hidden="true" />{label}
                  </button>
                ))}
              </div>
            </section>
          </>
        )}

        {finder !== null && (
          <section className="mt-4" aria-label="場所を選ぶ">
            <button type="button" className="tc-focus-ring min-h-11 text-sm underline" onClick={() => setFinder(null)}>← 戻る</button>
            <Suspense fallback={<p role="status">読み込み中…</p>}>
              <PlaceFinder tab={finder} onTab={setFinder} onPick={pickDraft} pickLabel="♡ 残す" planId={options.planId ?? undefined} />
            </Suspense>
          </section>
        )}

        <section className="mt-4 grid gap-2" aria-label="ひとことといつ">
          <label className="text-sm text-ink-700" htmlFor="wish-note">ひとこと(任意)</label>
          <input id="wish-note" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)}
            className="tc-focus-ring min-h-11 w-full rounded-xl border border-cloud-200 bg-cloud-0 px-3 text-ink-900"
            placeholder="例: 時間がなくて行けず" />
          <div className="flex gap-2" role="radiogroup" aria-label="いつ">
            {([['next_trip', '次の旅行で'], ['someday', 'いつか']] as [WishWhen, string][]).map(([v, l]) => (
              <button key={v} type="button" role="radio" aria-checked={when === v}
                className={`tc-focus-ring tc-pill min-h-11 ${when === v ? 'is-active font-semibold' : ''}`}
                onClick={() => setWhen(when === v ? null : v)}>{l}</button>
            ))}
          </div>
        </section>

        <p className="mt-4 text-xs text-ink-600">圏外でも残せます(つながった時に送ります)。住所・写真はあとから自動で入れられます。</p>
      </div>
    </div>
  );
};

export default WishSheet;
