/**
 * PlacePage - 場所の詳細(DOC-04 SC-09、FR-008)。
 *
 * [Gate C2] backend/app/api/v1/places.py の画面。
 * - 正式名・別名・住所・入口・階・電話・Web・営業時間・休業日・価格帯・予約の要否・アクセシビリティ・メモと、項目ごとの出典
 * - 電話は確認してから発信する。この場所を使う予定(見られる旅行のもの)へ移れる
 * - 直せるのは、この場所を使う全ての旅行を編集できる人だけ(共有の場所を、ほかの旅行の分まで書き換えさせない)
 * - [Gate G4] MAP-02 最終入場・ラストオーダー、日付ごとの例外の営業(臨時休業・特別営業。曜日より優先)、
 *   その日の実際の営業時間の確認、入口ごとの地点、出典によって値が違う項目の比べ
 */
import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getPlaceInfo, putOpeningHours, updatePlace } from '@/services/api';
import { getDayHours, putEntrances, putSpecialHours } from '@/services/api/g4';
import type { DayHours, OpeningHoursItem, PlaceEntrance, PlaceInfo, PlacePatch, SpecialHoursItem } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeTelHref } from '@/utils/safeNavigation';

const DAYS = ['月', '火', '水', '木', '金', '土', '日'];
type TextKey = 'name' | 'address' | 'phone' | 'website' | 'entrance_note' | 'floor' | 'price_range' |
  'accessibility_note' | 'closed_days' | 'note';
const FIELDS: Array<{ key: TextKey; label: string; long?: boolean }> = [
  { key: 'name', label: '正式名' }, { key: 'address', label: '住所' }, { key: 'entrance_note', label: '入口' },
  { key: 'floor', label: '階' }, { key: 'phone', label: '電話' }, { key: 'website', label: 'Web' },
  { key: 'closed_days', label: '休業日' }, { key: 'price_range', label: '価格帯' },
  { key: 'accessibility_note', label: 'アクセシビリティ', long: true }, { key: 'note', label: 'メモ', long: true },
];

type Form = Record<TextKey, string> & { aliases: string; reservation_required: '' | 'yes' | 'no' };

const toForm = (p: PlaceInfo): Form => ({
  ...(Object.fromEntries(FIELDS.map((f) => [f.key, (p[f.key] as string | null) ?? ''])) as Record<TextKey, string>),
  aliases: p.aliases.join('、'),
  reservation_required: p.reservation_required === null ? '' : p.reservation_required ? 'yes' : 'no',
});

const FIELD_LABEL: Record<string, string> = Object.fromEntries(FIELDS.map((f) => [f.key, f.label]));
const todayIso = () => new Date().toISOString().slice(0, 10);
const blankSpecial = (): SpecialHoursItem => ({ local_date: todayIso(), kind: 'closed', open_time: null, close_time: null, last_entry: null, last_order: null, note: null });
const blankEntrance = (): PlaceEntrance => ({ label: '', latitude: null, longitude: null, note: null, accessible: null });
const numOrNull = (v: string): number | null => (v.trim() === '' || Number.isNaN(Number(v)) ? null : Number(v));

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' }) : '');

const PlacePage: React.FC = () => {
  const { planId, placeId } = useParams<{ planId: string; placeId: string }>();
  const navigate = useNavigate();
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [hours, setHours] = useState<OpeningHoursItem[]>([]);
  const [special, setSpecial] = useState<SpecialHoursItem[]>([]);
  const [entrances, setEntrances] = useState<PlaceEntrance[]>([]);
  const [checkDate, setCheckDate] = useState(todayIso());
  const [dayHours, setDayHours] = useState<DayHours | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const apply = (p: PlaceInfo) => {
    setPlace(p);
    setForm(toForm(p));
    setHours(p.opening_hours);
    setSpecial(p.special_hours ?? []);
    setEntrances(p.entrances ?? []);
  };

  const load = useCallback(async () => {
    if (!placeId) return;
    try {
      apply(await getPlaceInfo(placeId));
    } catch (e) {
      setError(errorDetailMessage(e, '場所を取得できませんでした'));
    } finally {
      setIsLoading(false);
    }
  }, [placeId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!planId || !placeId) return <div className="p-8 text-center text-ink-700">場所が選択されていません。</div>;

  const run = async (fn: () => Promise<PlaceInfo>, done: string, fallback: string) => {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      apply(await fn());
      setMessage(done);
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
      await load();
    } finally {
      setBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!place || !form) return;
    const patch: PlacePatch = {};
    for (const f of FIELDS) {
      const v = form[f.key].trim();
      if (v !== ((place[f.key] as string | null) ?? '')) (patch as Record<string, unknown>)[f.key] = v || null;
    }
    const aliases = form.aliases.split(/[、,]/).map((a) => a.trim()).filter(Boolean);
    if (aliases.join('、') !== place.aliases.join('、')) patch.aliases = aliases;
    const rr = form.reservation_required === '' ? null : form.reservation_required === 'yes';
    if (rr !== place.reservation_required) patch.reservation_required = rr;
    if (Object.keys(patch).length === 0) {
      setMessage('変更はありません');
      return;
    }
    run(() => updatePlace(place.id, patch, place.revision), '場所の情報を保存しました', '保存できませんでした');
  };

  const saveHours = () => {
    if (!place) return;
    run(() => putOpeningHours(place.id, hours, place.revision), '営業時間を保存しました', '営業時間を保存できませんでした');
  };

  const saveSpecial = () => {
    if (!place) return;
    run(() => putSpecialHours(place.id, special, place.revision), '例外の日を保存しました', '例外の日を保存できませんでした');
  };

  const saveEntrances = () => {
    if (!place) return;
    run(() => putEntrances(place.id, entrances, place.revision), '入口を保存しました', '入口を保存できませんでした');
  };

  const checkDay = async () => {
    if (!place) return;
    setError(null);
    try {
      setDayHours(await getDayHours(place.id, checkDate));
    } catch (e) {
      setError(errorDetailMessage(e, 'その日の営業時間を確かめられませんでした'));
    }
  };

  const setSp = (i: number, patch: Partial<SpecialHoursItem>) =>
    setSpecial(special.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const setEn = (i: number, patch: Partial<PlaceEntrance>) =>
    setEntrances(entrances.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const call = () => {
    const tel = safeTelHref(place?.phone);
    if (place && tel && window.confirm(`${place.name}(${place.phone})に電話をかけますか?`)) {
      window.location.href = tel;
    }
  };

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/candidates`)} className="mb-2">← 候補箱へ戻る</Button>
      <h1 className="text-2xl font-bold text-ink-900">場所の詳細</h1>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" role="status">{message}</div>}
      {isLoading ? (
        <div className="py-12 flex justify-center"><LoadingSpinner /></div>
      ) : place && form && (
        <>
          <Card className="mt-4 p-4">
            <section aria-label="場所の情報">
              <h2 className="text-lg font-semibold text-ink-900">{place.name}</h2>
              {place.aliases.length > 0 && <p className="text-sm text-ink-700">別名: {place.aliases.join('、')}</p>}
              {place.phone && (
                <Button size="sm" variant="outline" className="mt-2" onClick={call}>電話をかける({place.phone})</Button>
              )}
              {!place.can_edit && (
                <p className="text-sm text-ink-700 mt-2">この場所を使うすべての旅行を編集できる人だけが直せます(見るだけです)。</p>
              )}
              <form aria-label="場所の情報を直す" onSubmit={save} className="mt-3 space-y-2">
                {FIELDS.map((f) => (
                  <div key={f.key}>
                    <label className="block text-sm text-ink-900">{f.label}
                      {f.long ? (
                        <textarea className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" rows={2} value={form[f.key]}
                          disabled={!place.can_edit} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                      ) : (
                        <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form[f.key]}
                          disabled={!place.can_edit} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} />
                      )}
                    </label>
                    {place.sources[f.key] && (
                      <p className="text-xs text-ink-700" data-testid={`source-${f.key}`}>
                        出典: {place.sources[f.key]!.label}{place.sources[f.key]!.retrieved_at ? `(${fmt(place.sources[f.key]!.retrieved_at)})` : ''}
                      </p>
                    )}
                  </div>
                ))}
                <label className="block text-sm text-ink-900">別名(「、」区切り)
                  <input className="mt-1 w-full border rounded-sm px-2 py-1 text-ink-900" value={form.aliases}
                    disabled={!place.can_edit} onChange={(e) => setForm({ ...form, aliases: e.target.value })} />
                </label>
                <label className="block text-sm text-ink-900">予約
                  <select className="ml-2 border rounded-sm px-2 py-1 text-ink-900" value={form.reservation_required}
                    disabled={!place.can_edit}
                    onChange={(e) => setForm({ ...form, reservation_required: e.target.value as Form['reservation_required'] })}>
                    <option value="">分からない</option>
                    <option value="yes">要予約</option>
                    <option value="no">予約不要</option>
                  </select>
                </label>
                {place.can_edit && <Button type="submit" disabled={busy}>場所の情報を保存</Button>}
              </form>
            </section>
          </Card>

          <Card className="mt-4 p-4">
            <section aria-label="営業時間">
              <h2 className="text-lg font-semibold text-ink-900">営業時間</h2>
              {place.sources.opening_hours && (
                <p className="text-xs text-ink-700">出典: {place.sources.opening_hours.label}({fmt(place.sources.opening_hours.retrieved_at)})</p>
              )}
              {hours.length === 0 && <p className="text-sm text-ink-700 mt-1">営業時間は登録されていません。</p>}
              <ul className="mt-2 space-y-2">
                {hours.map((h, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-2 text-sm text-ink-900">
                    <label>曜日
                      <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={h.day_of_week} disabled={!place.can_edit}
                        onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, day_of_week: Number(e.target.value) } : x)))}>
                        {DAYS.map((d, k) => <option key={k} value={k}>{d}</option>)}
                      </select>
                    </label>
                    <label>開く
                      <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={h.open_time} disabled={!place.can_edit}
                        onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, open_time: e.target.value } : x)))} />
                    </label>
                    <label>閉じる
                      <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={h.close_time} disabled={!place.can_edit}
                        onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, close_time: e.target.value } : x)))} />
                    </label>
                    <label>最終入場
                      <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={h.last_entry ?? ''} disabled={!place.can_edit}
                        onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, last_entry: e.target.value || null } : x)))} />
                    </label>
                    <label>ラストオーダー
                      <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={h.last_order ?? ''} disabled={!place.can_edit}
                        onChange={(e) => setHours(hours.map((x, j) => (j === i ? { ...x, last_order: e.target.value || null } : x)))} />
                    </label>
                    {h.close_time < h.open_time && <span>(日をまたぐ)</span>}
                    {place.can_edit && (
                      <Button size="sm" variant="ghost" aria-label={`${DAYS[h.day_of_week]}曜日の営業時間を削除`}
                        onClick={() => setHours(hours.filter((_, j) => j !== i))}>削除</Button>
                    )}
                  </li>
                ))}
              </ul>
              {place.can_edit && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" disabled={hours.length >= 21}
                    onClick={() => setHours([...hours, { day_of_week: 0, open_time: '09:00', close_time: '17:00' }])}>営業時間を追加</Button>
                  <Button size="sm" disabled={busy} onClick={saveHours}>営業時間を保存</Button>
                </div>
              )}
            </section>
          </Card>

          <Card className="mt-4 p-4">
            <section aria-label="例外の日">
              <h2 className="text-lg font-semibold text-ink-900">例外の日(臨時休業・特別営業)</h2>
              <p className="text-sm text-ink-700">年末年始・祝日・臨時休業など。その日は曜日の営業時間より優先します。</p>
              {special.length === 0 && <p className="text-sm text-ink-700 mt-1">登録されていません。</p>}
              <ul className="mt-2 space-y-2">
                {special.map((sp, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-2 text-sm text-ink-900" aria-label={`例外の日 ${i + 1}`}>
                    <label>日付
                      <input type="date" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.local_date} disabled={!place.can_edit}
                        onChange={(e) => setSp(i, { local_date: e.target.value })} />
                    </label>
                    <label>この日は
                      <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.kind} disabled={!place.can_edit}
                        onChange={(e) => setSp(i, e.target.value === 'closed'
                          ? { kind: 'closed', open_time: null, close_time: null, last_entry: null, last_order: null }
                          : { kind: 'open', open_time: sp.open_time ?? '10:00', close_time: sp.close_time ?? '17:00' })}>
                        <option value="closed">休み</option>
                        <option value="open">この時間だけ営業</option>
                      </select>
                    </label>
                    {sp.kind === 'open' && (
                      <>
                        <label>開く
                          <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.open_time ?? ''} disabled={!place.can_edit}
                            onChange={(e) => setSp(i, { open_time: e.target.value })} />
                        </label>
                        <label>閉じる
                          <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.close_time ?? ''} disabled={!place.can_edit}
                            onChange={(e) => setSp(i, { close_time: e.target.value })} />
                        </label>
                        <label>最終入場
                          <input type="time" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.last_entry ?? ''} disabled={!place.can_edit}
                            onChange={(e) => setSp(i, { last_entry: e.target.value || null })} />
                        </label>
                      </>
                    )}
                    <label>メモ
                      <input className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={sp.note ?? ''} maxLength={200} disabled={!place.can_edit}
                        onChange={(e) => setSp(i, { note: e.target.value || null })} />
                    </label>
                    {place.can_edit && (
                      <Button size="sm" variant="ghost" aria-label={`${sp.local_date}の例外の日を削除`}
                        onClick={() => setSpecial(special.filter((_, j) => j !== i))}>削除</Button>
                    )}
                  </li>
                ))}
              </ul>
              {place.can_edit && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" disabled={special.length >= 200} onClick={() => setSpecial([...special, blankSpecial()])}>例外の日を追加</Button>
                  <Button size="sm" disabled={busy} onClick={saveSpecial}>例外の日を保存</Button>
                </div>
              )}
              <div className="mt-4 flex flex-wrap items-end gap-2 text-sm text-ink-900">
                <label>その日の営業時間を確かめる
                  <input type="date" className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={checkDate}
                    onChange={(e) => setCheckDate(e.target.value)} />
                </label>
                <Button size="sm" variant="outline" onClick={checkDay}>確かめる</Button>
              </div>
              {dayHours && (
                <p className="mt-2 text-sm text-ink-900" role="status" aria-label="その日の営業時間">
                  {dayHours.summary}
                  {dayHours.source === 'special' && '(例外の日)'}
                  {dayHours.windows.some((w) => w.last_entry) && ` 最終入場 ${dayHours.windows.filter((w) => w.last_entry).map((w) => w.last_entry).join('・')}`}
                  {dayHours.note && `(${dayHours.note})`}
                </p>
              )}
            </section>
          </Card>

          <Card className="mt-4 p-4">
            <section aria-label="入口">
              <h2 className="text-lg font-semibold text-ink-900">入口</h2>
              <p className="text-sm text-ink-700">正面・裏口・駐車場・駅の出口など、入口ごとの位置(緯度・経度)を登録できます。</p>
              {entrances.length === 0 && <p className="text-sm text-ink-700 mt-1">登録されていません。</p>}
              <ul className="mt-2 space-y-2">
                {entrances.map((en, i) => (
                  <li key={i} className="flex flex-wrap items-end gap-2 text-sm text-ink-900" aria-label={`入口 ${i + 1}`}>
                    <label>名前
                      <input className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={en.label} maxLength={100} disabled={!place.can_edit}
                        onChange={(e) => setEn(i, { label: e.target.value })} />
                    </label>
                    <label>緯度
                      <input inputMode="decimal" className="ml-1 w-28 border rounded-sm px-2 py-1 text-ink-900" value={en.latitude ?? ''} disabled={!place.can_edit}
                        onChange={(e) => setEn(i, { latitude: numOrNull(e.target.value) })} />
                    </label>
                    <label>経度
                      <input inputMode="decimal" className="ml-1 w-28 border rounded-sm px-2 py-1 text-ink-900" value={en.longitude ?? ''} disabled={!place.can_edit}
                        onChange={(e) => setEn(i, { longitude: numOrNull(e.target.value) })} />
                    </label>
                    <label>段差なし
                      <select className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={en.accessible === null ? '' : en.accessible ? 'yes' : 'no'} disabled={!place.can_edit}
                        onChange={(e) => setEn(i, { accessible: e.target.value === '' ? null : e.target.value === 'yes' })}>
                        <option value="">分からない</option>
                        <option value="yes">段差なし</option>
                        <option value="no">段差あり</option>
                      </select>
                    </label>
                    <label>メモ
                      <input className="ml-1 border rounded-sm px-2 py-1 text-ink-900" value={en.note ?? ''} maxLength={300} disabled={!place.can_edit}
                        onChange={(e) => setEn(i, { note: e.target.value || null })} />
                    </label>
                    {place.can_edit && (
                      <Button size="sm" variant="ghost" aria-label={`入口「${en.label || i + 1}」を削除`}
                        onClick={() => setEntrances(entrances.filter((_, j) => j !== i))}>削除</Button>
                    )}
                  </li>
                ))}
              </ul>
              {place.can_edit && (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="outline" disabled={entrances.length >= 10} onClick={() => setEntrances([...entrances, blankEntrance()])}>入口を追加</Button>
                  <Button size="sm" disabled={busy} onClick={saveEntrances}>入口を保存</Button>
                </div>
              )}
            </section>
          </Card>

          {place.source_history && Object.keys(place.source_history).length > 0 && (
            <Card className="mt-4 p-4">
              <section aria-label="出典による違い">
                <h2 className="text-lg font-semibold text-ink-900">出典による違い</h2>
                <p className="text-sm text-ink-700">出典によって値が違う項目です(新しい順)。正しい値を確かめて直してください。</p>
                <dl className="mt-2 text-sm text-ink-900 space-y-2">
                  {Object.entries(place.source_history).map(([field, items]) => (
                    <div key={field}>
                      <dt className="font-medium">{FIELD_LABEL[field] ?? field}</dt>
                      <dd>
                        <ul className="list-disc ml-5">
                          {items.map((it, k) => (
                            <li key={k}>{it.value ?? '(空)'} — {it.label}{it.retrieved_at ? `(${fmt(it.retrieved_at)})` : ''}</li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            </Card>
          )}

          <Card className="mt-4 p-4">
            <section aria-label="この場所を使う予定">
              <h2 className="text-lg font-semibold text-ink-900">この場所を使う予定</h2>
              {place.events.length === 0 ? <p className="text-sm text-ink-700 mt-1">ありません。</p> : (
                <ul className="mt-2 text-sm text-ink-900 space-y-1">
                  {place.events.map((e) => (
                    <li key={e.event_id}>{e.date} {e.local_start_time ?? ''} {e.title}({e.plan_title})</li>
                  ))}
                </ul>
              )}
            </section>
          </Card>
        </>
      )}
    </div>
  );
};

export default PlacePage;
