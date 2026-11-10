/**
 * [Gate BookingFix] 旅行の基本情報(題名・方面・日程・人数・予算・メモ)の編集。
 * 日程を変えると全部の日と予定の日時が一緒に動く。短くして予定のある日が消える時は、一覧を見せて確認してから消す。
 * [Gate TripHead] 背景(表紙)の写真もここから変えられる(変えられる人だけ。写真の選択は上に重ねて開き、保存はその場で効く)。
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { getPlanBasics, reschedulePlan, savePlanBasics } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { LEGEND_MODES, transportMode } from '@/utils/transportModes';

/** [Gate JourneyMove] 出発・帰着の移動手段の選択肢 */
const JOURNEY_MODES = LEGEND_MODES.filter((m) => m !== 'helicopter');
import TripCover from '@/components/trip/TripCover';
import CoverPhotoDialog from '@/components/trip/CoverPhotoDialog';
import { getPlanCover } from '@/services/api/g11';
import type { PlanCover } from '@/services/api/types/g11';
import { useCoverPhoto, useCoverVersions } from '@/hooks/useCoverPhoto';

interface Props {
  planId: string;
  revision: number;
  firstDate: string | null;
  lastDate: string | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: (message: string | null) => void;
}
type Lost = { date: string; events: string[] }[];

const PlanBasicsDialog: React.FC<Props> = ({ planId, revision, firstDate, lastDate, isOpen, onClose, onSaved }) => {
  const [title, setTitle] = useState('');
  const [destination, setDestination] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [party, setParty] = useState('');
  const [budget, setBudget] = useState('');
  const [description, setDescription] = useState('');
  const [preferences, setPreferences] = useState<Record<string, unknown>>({});
  // [Gate JourneyEnds] 旅の出発・到着(任意)
  const [journeyOn, setJourneyOn] = useState(false);
  const [startPlace, setStartPlace] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endPlace, setEndPlace] = useState('');
  const [endTime, setEndTime] = useState('');
  // [Gate JourneyMove] 出発地・帰着地との移動手段と所要時間(分)
  const [startMode, setStartMode] = useState('');
  const [startMin, setStartMin] = useState('');
  const [endMode, setEndMode] = useState('');
  const [endMin, setEndMin] = useState('');
  const [lost, setLost] = useState<Lost | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // [Gate TripHead] 背景の写真(表紙)。読めない・変えられない時は欄ごと出さない
  const [cover, setCover] = useState<PlanCover | null>(null);
  const [canEditCover, setCanEditCover] = useState(false);
  const [coverOpen, setCoverOpen] = useState(false);
  const coverVersion = useCoverVersions((st) => st.versions[planId] ?? 0);
  useEffect(() => {
    if (!isOpen) return undefined;
    let active = true;
    getPlanCover(planId).then((r) => {
      if (!active) return;
      setCover(r.cover);
      setCanEditCover(r.can_edit);
    }).catch(() => { if (active) { setCover(null); setCanEditCover(false); } });
    return () => { active = false; };
  }, [isOpen, planId, coverVersion]);
  const coverPhoto = useCoverPhoto(isOpen ? planId : null, cover, '');

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setLost(null);
    setStart(firstDate ?? '');
    setEnd(lastDate ?? '');
    getPlanBasics(planId).then((plan) => {
      setTitle(plan.title ?? '');
      setDestination(plan.destination ?? '');
      setBudget(plan.budget != null ? String(plan.budget) : '');
      setDescription(plan.description ?? '');
      const prefs = plan.preferences ?? {};
      setPreferences(prefs);
      setParty(prefs.party_size != null ? String(prefs.party_size) : '');
      setJourneyOn(Boolean(plan.journey_enabled));
      setStartPlace(plan.journey_start_place ?? '');
      setStartTime((plan.journey_start_time ?? '').slice(0, 5));
      setEndPlace(plan.journey_end_place ?? '');
      setEndTime((plan.journey_end_time ?? '').slice(0, 5));
      setStartMode(plan.journey_start_mode ?? '');
      setStartMin(plan.journey_start_minutes != null ? String(plan.journey_start_minutes) : '');
      setEndMode(plan.journey_end_mode ?? '');
      setEndMin(plan.journey_end_minutes != null ? String(plan.journey_end_minutes) : '');
      if (!firstDate && plan.start_date) setStart(plan.start_date.slice(0, 10));
      if (!lastDate && plan.end_date) setEnd(plan.end_date.slice(0, 10));
    }).catch((e) => setError(errorDetailMessage(e, '旅行の情報を読み込めませんでした')));
  }, [isOpen, planId, firstDate, lastDate]);

  const submit = async (confirmRemove: boolean) => {
    if (!title.trim()) {
      setError('題名を入れてください');
      return;
    }
    if ((start && !end) || (!start && end)) {
      setError('出発日と最終日の両方を入れてください');
      return;
    }
    if (start && end && end < start) {
      setError('最終日は出発日より後にしてください');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      let message: string | null = null;
      if (start && end && (start !== firstDate || end !== lastDate)) {
        const moved = await reschedulePlan(planId, revision, start, end, confirmRemove);
        if (moved.reservations_not_moved > 0) {
          message = `日程を変えました。予約 ${moved.reservations_not_moved} 件の日時は変わっていません。予約の画面で確かめてください。`;
        }
      }
      const nextPrefs = { ...preferences };
      if (party) nextPrefs.party_size = Number(party);
      else delete nextPrefs.party_size;
      await savePlanBasics(planId, {
        title: title.trim(), destination: destination.trim() || null, description: description.trim() || null,
        budget: budget ? Number(budget) : null, preferences: nextPrefs,
        journey_enabled: journeyOn, journey_start_place: startPlace.trim() || null, journey_start_time: startTime || null,
        journey_end_place: endPlace.trim() || null, journey_end_time: endTime || null,
        journey_start_mode: startMode || null, journey_start_minutes: startMin ? Number(startMin) : null,
        journey_end_mode: endMode || null, journey_end_minutes: endMin ? Number(endMin) : null,
      });
      onSaved(message);
      onClose();
    } catch (e) {
      const detail = (e as { response?: { status?: number; data?: { detail?: { code?: string; days?: Lost } } } }).response;
      if (detail?.status === 409 && detail.data?.detail?.code === 'days_have_events') setLost(detail.data.detail.days ?? []);
      else setError(errorDetailMessage(e, '保存できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const input = 'block w-full mt-1 border border-cloud-200 rounded-md bg-surface px-3 py-2 text-sm text-ink-900';
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="旅行の基本情報" size="lg">
      <form onSubmit={(e) => { e.preventDefault(); void submit(false); }}>
        <Modal.Body>
          <div className="space-y-3" data-testid="plan-basics">
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            <div><label htmlFor="basics-title" className="text-sm text-ink-800">題名</label><input id="basics-title" className={input} value={title} onChange={(e) => setTitle(e.target.value)} /></div>
            <div><label htmlFor="basics-destination" className="text-sm text-ink-800">方面・行き先</label><input id="basics-destination" className={input} value={destination} onChange={(e) => setDestination(e.target.value)} /></div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="basics-start" className="text-sm text-ink-800">出発日</label><input id="basics-start" type="date" className={input} value={start} onChange={(e) => { setStart(e.target.value); setLost(null); }} /></div>
              <div><label htmlFor="basics-end" className="text-sm text-ink-800">最終日</label><input id="basics-end" type="date" className={input} value={end} onChange={(e) => { setEnd(e.target.value); setLost(null); }} /></div>
            </div>
            <p className="text-xs text-ink-700">日程を変えると、予定も一緒に新しい日付へ動きます。日数が増えると空の日を足します。予約の日時は変わりません。</p>
            {lost && (
              <div role="alert" className="rounded-md bg-warning-soft p-3 text-sm text-ink-900" data-testid="basics-lost">
                <p className="font-semibold">短くすると、次の日の予定が消えます</p>
                <ul className="mt-1 list-disc pl-5">{lost.map((d) => <li key={d.date}>{`${d.date}: ${d.events.join('、')}`}</li>)}</ul>
                <Button type="button" variant="outline" size="sm" className="mt-2" loading={busy} onClick={() => void submit(true)}>消して日程を変える</Button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div><label htmlFor="basics-party" className="text-sm text-ink-800">人数</label><input id="basics-party" type="number" min={1} max={99} className={input} value={party} onChange={(e) => setParty(e.target.value)} /></div>
              <div><label htmlFor="basics-budget" className="text-sm text-ink-800">予算(円)</label><input id="basics-budget" type="number" min={0} className={input} value={budget} onChange={(e) => setBudget(e.target.value)} /></div>
            </div>
            <fieldset className="rounded-md border border-cloud-200 p-3" data-testid="basics-journey">
              <legend className="px-1 text-sm text-ink-800">出発と帰着(任意)</legend>
              <label className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" checked={journeyOn} onChange={(e) => setJourneyOn(e.target.checked)} data-testid="basics-journey-on" />
                旅程の最初に「出発」、最後に「帰着」を出す
              </label>
              {journeyOn && (
                <div className="mt-2 grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
                  <div><label htmlFor="basics-start-place" className="text-sm text-ink-800">出発の場所</label><input id="basics-start-place" className={input} maxLength={120} placeholder="例: 自宅・東京駅" value={startPlace} onChange={(e) => setStartPlace(e.target.value)} /></div>
                  <div><label htmlFor="basics-start-time" className="text-sm text-ink-800">出発の時刻</label><input id="basics-start-time" type="time" className={input} value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
                  <div><label htmlFor="basics-start-mode" className="text-sm text-ink-800">出発地から最初の予定までの移動手段</label>
                    <select id="basics-start-mode" className={input} value={startMode} onChange={(e) => setStartMode(e.target.value)}>
                      <option value="">未設定</option>
                      {JOURNEY_MODES.map((m) => <option key={m} value={m}>{transportMode(m).label}</option>)}
                    </select></div>
                  <div><label htmlFor="basics-start-min" className="text-sm text-ink-800">所要時間(分)</label>
                    <input id="basics-start-min" type="number" min={0} max={1440} inputMode="numeric" className={input} value={startMin}
                      onChange={(e) => setStartMin(e.target.value)} /></div>
                  <div><label htmlFor="basics-end-place" className="text-sm text-ink-800">帰着(旅の終わり)の場所</label><input id="basics-end-place" className={input} maxLength={120} placeholder="例: 自宅" value={endPlace} onChange={(e) => setEndPlace(e.target.value)} /></div>
                  <div><label htmlFor="basics-end-time" className="text-sm text-ink-800">帰着の時刻</label><input id="basics-end-time" type="time" className={input} value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
                  <div><label htmlFor="basics-end-mode" className="text-sm text-ink-800">最後の予定から帰着地までの移動手段</label>
                    <select id="basics-end-mode" className={input} value={endMode} onChange={(e) => setEndMode(e.target.value)}>
                      <option value="">未設定</option>
                      {JOURNEY_MODES.map((m) => <option key={m} value={m}>{transportMode(m).label}</option>)}
                    </select></div>
                  <div><label htmlFor="basics-end-min" className="text-sm text-ink-800">所要時間(分)</label>
                    <input id="basics-end-min" type="number" min={0} max={1440} inputMode="numeric" className={input} value={endMin}
                      onChange={(e) => setEndMin(e.target.value)} /></div>
                </div>
              )}
              <p className="mt-2 text-xs text-ink-700">住所は要りません(所要時間は自動では計算できないので、分かれば入れてください)。2 日目からは前の夜の宿(種類「宿」の予定)から出発として、日の最初と最後に出します。</p>
            </fieldset>
            {canEditCover && (
              <div data-testid="basics-cover">
                <p className="text-sm text-ink-800">背景の写真</p>
                <div className="mt-1 flex items-center gap-3">
                  <TripCover size="card" destination={destination} tripTitle={title} startDate={start || null}
                    photo={coverPhoto.photo} onPhotoError={coverPhoto.onError} className="w-40 shrink-0 rounded-md" aria-hidden="true" />
                  <div className="min-w-0">
                    <Button type="button" variant="outline" size="sm" onClick={() => setCoverOpen(true)} data-testid="basics-cover-change">
                      {cover ? '写真を変更' : '写真を設定'}
                    </Button>
                    <p className="mt-1 text-xs text-ink-700">旅程の上の表紙・一覧のカードに使います。選んだ時点で保存されます。</p>
                  </div>
                </div>
              </div>
            )}
            <div><label htmlFor="basics-description" className="text-sm text-ink-800">メモ</label><textarea id="basics-description" rows={3} className={input} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="ghost" onClick={onClose}>キャンセル</Button>
          <Button type="submit" variant="primary" loading={busy} data-testid="plan-basics-save">保存</Button>
        </Modal.Footer>
      </form>
      {canEditCover && (
        <CoverPhotoDialog isOpen={coverOpen} onClose={() => setCoverOpen(false)} planId={planId}
          tripTitle={title} destination={destination} startDate={start || null} current={cover} onSaved={setCover} />
      )}
    </Modal>
  );
};

export default PlanBasicsDialog;
