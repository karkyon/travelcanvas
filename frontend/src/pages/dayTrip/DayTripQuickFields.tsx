/**
 * [FR-061] 新しい旅行(日帰り)の欄(詳細設計 §3.1)。クイックの「旅行の基本」の中で、日帰りの時だけ出す。
 * 目的地(名前で検索・行きたい場所から)・出発地(現在地 / 自宅 / 入力)・道の使い方・出発日・出発時刻・家に着きたい時刻。
 * 現在地は押した時だけ取り、小数 2 桁(約 1km)に丸めた値と「現在地のあたり」だけを使う。
 */
import React, { useState } from 'react';
import { Crosshair, Home, MapPin } from 'lucide-react';
import PlaceFinder, { type PlaceDraft, type PlaceTab } from '@/components/search/PlaceFinder';
import { ROADS } from '@/services/api/dayTrip';
import type { DayTripDraft } from './dayTripDraft';
import { getHomePlace } from '@/services/api/homePlace';

const field = 'tc-focus-ring w-full min-h-11 rounded-xl border border-cloud-200 bg-cloud-0 px-3 text-ink-900';

const DayTripQuickFields: React.FC<{ value: DayTripDraft; onChange: (d: DayTripDraft) => void }> = ({ value, onChange }) => {
  const [destTab, setDestTab] = useState<PlaceTab>('search');
  const [originTab, setOriginTab] = useState<PlaceTab>('search');
  const [originInput, setOriginInput] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const set = (p: Partial<DayTripDraft>) => onChange({ ...value, ...p });

  const pickDest = (d: PlaceDraft) => {
    if (d.latitude == null || d.longitude == null) { setNote('位置が分からない場所です。地図で選んでください'); return; }
    setNote(null);
    set({ dest: { label: d.name, lat: d.latitude, lng: d.longitude, spot_id: null }, destAddress: d.address });
  };
  const here = () => {
    if (!navigator.geolocation) { setNote('位置の許可がありません。出発地を入力してください'); return; }
    navigator.geolocation.getCurrentPosition((p) => {
      setNote(null);
      set({ originKind: 'here', origin: { label: '現在地のあたり', lat: Math.round(p.coords.latitude * 100) / 100,
        lng: Math.round(p.coords.longitude * 100) / 100 } });
    }, () => setNote('位置の許可がありません。出発地を入力してください'), { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 });
  };
  const home = async () => {
    try {
      const h = await getHomePlace();
      if (!h.place) { setNote('自宅の場所が未登録です。プロフィールで登録するか、出発地を入力してください'); return; }
      setNote(null);
      set({ originKind: 'home', origin: { label: h.place.label || '自宅', lat: Math.round(h.place.latitude * 100) / 100,
        lng: Math.round(h.place.longitude * 100) / 100 } });
    } catch {
      setNote('自宅の場所を読めませんでした。出発地を入力してください');
    }
  };

  return (
    <div className="space-y-4" data-testid="day-trip-fields">
      <section aria-labelledby="dt-dest">
        <p id="dt-dest" className="text-sm font-medium text-ink-900">最初に行きたい場所(目的地・必須)</p>
        {value.dest ? (
          <p className="mt-1 flex items-center gap-2 text-sm" data-testid="dt-dest-chosen"><MapPin size={14} aria-hidden="true" />{value.dest.label}
            <button type="button" className="tc-focus-ring underline min-h-11" onClick={() => set({ dest: null })}>選び直す</button></p>
        ) : <PlaceFinder tab={destTab} onTab={setDestTab} onPick={pickDest} withWish pickLabel="目的地にする" />}
      </section>
      <section aria-labelledby="dt-origin">
        <p id="dt-origin" className="text-sm font-medium text-ink-900">出発地(必須)</p>
        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-label="出発地">
          <button type="button" aria-pressed={value.originKind === 'here'} className="tc-focus-ring tc-pill min-h-11" onClick={here}>
            <Crosshair size={14} aria-hidden="true" />現在地</button>
          <button type="button" aria-pressed={value.originKind === 'home'} className="tc-focus-ring tc-pill min-h-11" onClick={() => void home()}>
            <Home size={14} aria-hidden="true" />自宅</button>
          <button type="button" aria-pressed={value.originKind === 'input'} className="tc-focus-ring tc-pill min-h-11"
            onClick={() => setOriginInput(true)}>入力</button>
        </div>
        {value.origin && <p className="mt-1 text-sm" data-testid="dt-origin-chosen">{`出発地: ${value.origin.label}`}</p>}
        {originInput && value.originKind !== 'input' && (
          <PlaceFinder tab={originTab} onTab={setOriginTab} pickLabel="出発地にする" onPick={(d) => {
            if (d.latitude == null || d.longitude == null) { setNote('位置が分からない場所です。地図で選んでください'); return; }
            setOriginInput(false);
            set({ originKind: 'input', origin: { label: d.name, lat: Math.round(d.latitude * 100) / 100, lng: Math.round(d.longitude * 100) / 100 } });
          }} />
        )}
      </section>
      <section aria-labelledby="dt-road">
        <p id="dt-road" className="text-sm font-medium text-ink-900">道の使い方</p>
        <div className="mt-1 flex flex-wrap gap-2" role="group" aria-labelledby="dt-road">
          {ROADS.map(([r, l]) => (
            <button key={r} type="button" aria-pressed={value.road === r} data-testid={`dt-road-${r}`}
              className={`tc-focus-ring tc-pill min-h-11 ${value.road === r ? 'is-active font-semibold' : ''}`} onClick={() => set({ road: r })}>{l}</button>
          ))}
        </div>
      </section>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <label className="text-sm text-ink-900">出発日(必須)
          <input type="date" className={field} value={value.date} onChange={(e) => set({ date: e.target.value })} /></label>
        <label className="text-sm text-ink-900">出発時刻
          <input type="time" className={field} value={value.depart} onChange={(e) => set({ depart: e.target.value || '09:00' })} /></label>
        <label className="text-sm text-ink-900">家に着きたい時刻(任意)
          <input type="time" className={field} value={value.homeBy} onChange={(e) => set({ homeBy: e.target.value })} /></label>
      </div>
      {note && <p role="status" className="text-sm text-ink-700">{note}</p>}
    </div>
  );
};

export default DayTripQuickFields;
