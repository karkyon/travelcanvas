/**
 * [Gate HomePlace] 自宅の場所の設定(本人だけ)。設定 → 自宅の場所、と旅程の出発・帰着の行から開く。
 *
 * 自宅は大事な情報なので、次はすべて本人が選ぶ(初めは「道の経路の提供元へ送る」だけ切っておく):
 * - 登録するか(「あとで」・「消す」でいつでもやめられる)
 * - 地図に自宅の印を出すか
 * - 出発・帰着の経路(自宅 ↔ 最初・最後の予定)に使うか
 * - 道に沿った経路を出すために、自宅の位置を道の経路の提供元(OpenStreetMap の OSRM)へ送るか(送らない時は直線)
 * 自宅の位置は暗号化して保存し、同行者・共有・しおりには出しません。
 */
import React, { Suspense, useEffect, useState } from 'react';
import { House, MapPin, Search, Trash2 } from 'lucide-react';
import { geocodeAddress, type GeocodeCandidate } from '@/services/api/planEdit';
import { deleteHomePlace, saveHomePlace, type HomePlace } from '@/services/api/homePlace';
import { loadHomePlace, setHomePlaceCache } from '@/hooks/useHomePlace';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const SpotMiniMap = React.lazy(() => import('@/components/planner/SpotMiniMap'));

interface Props {
  /** 保存・削除・あとで、の後(ダイアログを閉じる) */
  onDone?: () => void;
  /** ダイアログの中では「あとで」を出す */
  inDialog?: boolean;
}

const HomePlaceForm: React.FC<Props> = ({ onDone, inDialog = false }) => {
  const [home, setHome] = useState<HomePlace | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [label, setLabel] = useState('自宅');
  const [address, setAddress] = useState('');
  const [pos, setPos] = useState<[number, number] | null>(null);
  const [showOnMap, setShowOnMap] = useState(true);
  const [useForRoutes, setUseForRoutes] = useState(true);
  const [sendToProvider, setSendToProvider] = useState(false);
  const [candidates, setCandidates] = useState<GeocodeCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  useEffect(() => {
    let alive = true;
    void loadHomePlace(true).then((h) => {
      if (!alive) return;
      setHome(h);
      setLoaded(true);
      if (h?.place) {
        setLabel(h.place.label || '自宅');
        setAddress(h.place.address ?? '');
        setPos([h.place.latitude, h.place.longitude]);
      }
      if (h?.configured) {
        setShowOnMap(h.show_on_map);
        setUseForRoutes(h.use_for_routes);
        setSendToProvider(h.send_to_route_provider);
      }
      if (h === null) setMessage({ type: 'error', text: '自宅の場所を読み込めませんでした。時間をおいてもう一度開いてください' });
    });
    return () => { alive = false; };
  }, []);

  const search = async () => {
    if (!address.trim()) return;
    setBusy(true); setMessage(null);
    try {
      const r = await geocodeAddress(address);
      setCandidates(r.candidates);
      if (r.candidates.length === 0) setMessage({ type: 'error', text: r.unavailable ? '住所の検索が今は使えません。地図の印を動かして決めてください' : '見つかりませんでした。市区町村だけなど短くして探してください' });
    } catch (e) {
      setMessage({ type: 'error', text: errorDetailMessage(e, '住所を探せませんでした') });
    } finally { setBusy(false); }
  };

  const save = async () => {
    if (!pos) { setMessage({ type: 'error', text: '先に住所を探して、候補から選んでください' }); return; }
    setBusy(true); setMessage(null);
    try {
      const saved = await saveHomePlace({ label, address: address || null, latitude: pos[0], longitude: pos[1],
        show_on_map: showOnMap, use_for_routes: useForRoutes, send_to_route_provider: useForRoutes && sendToProvider }, home?.revision ?? 0);
      setHome(saved); setHomePlaceCache(saved);
      setMessage({ type: 'ok', text: '自宅の場所を保存しました(あなただけに見えます)' });
      onDone?.();
    } catch (e) {
      setMessage({ type: 'error', text: errorDetailMessage(e, '保存できませんでした。開き直してもう一度お試しください') });
    } finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true); setMessage(null);
    try {
      await deleteHomePlace();
      await loadHomePlace(true).then((h) => { setHome(h); });
      setPos(null); setAddress(''); setLabel('自宅'); setCandidates(null);
      setMessage({ type: 'ok', text: '自宅の場所を消しました' });
      onDone?.();
    } catch (e) {
      setMessage({ type: 'error', text: errorDetailMessage(e, '消せませんでした') });
    } finally { setBusy(false); }
  };

  if (!loaded) return <p className="text-sm text-ink-700" role="status">読み込み中…</p>;

  return (
    <div className="tc-home-form" data-testid="home-place-form">
      <p className="tc-kit-box text-sm">
        <House size={15} aria-hidden="true" className="inline mr-1 align-[-2px]" />
        自宅の場所は、旅程の地図の「自宅から出発」「自宅へ帰る」に使います。登録するか・地図に出すか・経路に使うかは、あなたが選べます。
        保存した場所は暗号化し、同行者・共有・しおりには出しません。
      </p>

      <label className="tc-home-field">
        <span>呼び名</span>
        <input value={label} maxLength={40} onChange={(e) => setLabel(e.target.value)} />
      </label>
      <div className="tc-home-field">
        <label htmlFor="home-address">住所・場所(番地まで入れなくても大丈夫です)</label>
        <div className="tc-home-row">
          <input id="home-address" value={address} maxLength={200} onChange={(e) => setAddress(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void search(); } }} placeholder="例: 横浜市港北区" />
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void search()} disabled={busy || !address.trim()}>
            <Search size={15} aria-hidden="true" />探す
          </button>
        </div>
        <p className="text-xs text-ink-700">探す時は、入れた言葉を場所の検索の提供元(OpenStreetMap など)へ送ります。送りたくない時は、探さずに地図の印を動かして決めてください。</p>
      </div>

      {candidates && candidates.length > 0 && (
        <ul className="tc-kit-list" aria-label="住所の候補">
          {candidates.slice(0, 5).map((c, i) => (
            <li key={`${c.latitude},${c.longitude},${i}`}>
              <button type="button" className="tc-focus-ring tc-home-cand" aria-pressed={pos?.[0] === c.latitude && pos?.[1] === c.longitude}
                onClick={() => { setPos([c.latitude, c.longitude]); if (c.address) setAddress(c.address); }}>
                <MapPin size={15} aria-hidden="true" /><span>{c.address ?? `${c.latitude.toFixed(4)}, ${c.longitude.toFixed(4)}`}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="tc-home-map">
        {pos ? (
          <Suspense fallback={<p className="text-sm text-ink-700">地図を読み込み中…</p>}>
            <SpotMiniMap latitude={pos[0]} longitude={pos[1]} height={200} label="自宅" onMove={(la, ln) => setPos([la, ln])} />
          </Suspense>
        ) : (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPos([35.6812, 139.7671])}>
            <MapPin size={15} aria-hidden="true" />住所を送らず、地図の印を動かして決める
          </button>
        )}
      </div>

      <fieldset className="tc-home-opts">
        <legend>使い方を選ぶ</legend>
        <label><input type="checkbox" checked={showOnMap} onChange={(e) => setShowOnMap(e.target.checked)} />旅程の地図に自宅の印を出す</label>
        <label><input type="checkbox" checked={useForRoutes} onChange={(e) => setUseForRoutes(e.target.checked)} />出発・帰着の経路(自宅 ↔ 最初・最後の予定)に使う</label>
        <label className={useForRoutes ? '' : 'is-off'}>
          <input type="checkbox" checked={useForRoutes && sendToProvider} disabled={!useForRoutes} onChange={(e) => setSendToProvider(e.target.checked)} />
          道に沿った経路にする(自宅の位置を道の経路の提供元 OSRM へ送ります。送らない時は直線で出します)
        </label>
      </fieldset>

      {message && <p role={message.type === 'error' ? 'alert' : 'status'} className={`text-sm ${message.type === 'error' ? 'text-red-700' : 'text-green-800'}`}>{message.text}</p>}

      <div className="tc-home-actions">
        {home?.configured && (
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void remove()} disabled={busy}>
            <Trash2 size={15} aria-hidden="true" />自宅の場所を消す
          </button>
        )}
        <span className="flex-1" />
        {inDialog && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={onDone} disabled={busy}>あとで</button>}
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" onClick={() => void save()} disabled={busy || !pos}>保存</button>
      </div>
    </div>
  );
};

export default HomePlaceForm;
