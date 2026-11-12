/**
 * [Gate PlanB] 案を作る(S2)・名前/理由/条件を変える。元: この日の今の案を写す・別の日を写す・白紙。まとめて作る(案の組)
 */
import React, { useEffect, useState } from 'react';
import Modal from '@/components/common/Modal';
import Button from '@/components/common/Button';
import { createVariant, patchVariant, REASONS, SCAFFOLD_REASONS, type VariantReason, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { TRANSPORTS } from './variantModel';

interface DayOption { id: string; date: string; label: string }
interface Props {
  planId: string;
  isOpen: boolean;
  date: string;
  dateLabel: string;
  /** 写せる日(今の案)。この日を除く */
  otherDays: DayOption[];
  revision: number;
  /** 変える時: その案 */
  editing?: VariantSummary | null;
  onClose: () => void;
  onDone: (dayId: string | null) => void;
  /** [PlanB-Weather] 開いた時の理由(雨の予報から作る時など) */
  presetReason?: VariantReason | null;
}

const SCAFFOLD_TEXT = {
  rain: '雨に合わせて組み替える(屋外の予定に印・屋内を優先・移動は電車と徒歩に)',
  delay: '遅れに合わせて予定の時刻をずらす',
  fatigue: '予定が多い時に、外す候補に印を付ける',
  transport: '区間の移動手段を「移動の既定」に変えて、所要時間を計算し直す',
};

const CreateVariantDialog: React.FC<Props> = ({ planId, isOpen, date, dateLabel, otherDays, revision, editing, onClose, onDone,
  presetReason }) => {
  const [source, setSource] = useState<'copy_active' | 'copy_day' | 'blank'>('copy_active');
  const [sourceDay, setSourceDay] = useState('');
  const [name, setName] = useState('');
  const [reason, setReason] = useState<VariantReason | null>(null);
  const [party, setParty] = useState('');
  const [transport, setTransport] = useState('');
  const [indoor, setIndoor] = useState(false);
  const [also, setAlso] = useState<Set<string>>(new Set());
  const [scaffold, setScaffold] = useState(true);
  const [delayMin, setDelayMin] = useState('60');
  const [delayAfter, setDelayAfter] = useState('');
  const [maxEvents, setMaxEvents] = useState('4');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    setBusy(false);
    setSource('copy_active');
    setSourceDay(otherDays[0]?.id ?? '');
    setAlso(new Set());
    setName(editing?.name ?? (presetReason === 'rain' ? '雨の日' : ''));
    setReason(editing?.reason ?? presetReason ?? null);
    setParty(editing?.conditions?.party_size ? String(editing.conditions.party_size) : '');
    setTransport(editing?.conditions?.transport_mode ?? '');
    setIndoor(Boolean(editing?.conditions?.prefer_indoor));
    setScaffold(true);
    setDelayMin('60');
    setDelayAfter('');
    setMaxEvents('4');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 開いた時に 1 回
  }, [isOpen]);

  const canScaffold = !editing && source !== 'blank' && reason !== null && SCAFFOLD_REASONS.includes(reason);
  const useScaffold = canScaffold && scaffold;
  const conditions = () => ({
    party_size: party ? Number(party) : null, transport_mode: transport || null, prefer_indoor: indoor,
    ...(useScaffold && reason === 'delay' ? { delay_minutes: Number(delayMin) || 60, delay_after: delayAfter || null } : {}),
    ...(useScaffold && reason === 'fatigue' ? { max_events: Number(maxEvents) || 4 } : {}),
  });
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (editing) {
        await patchVariant(planId, editing.day_id, revision, { name: name.trim(), reason: reason ?? '' as VariantReason, conditions: conditions() });
        onDone(editing.day_id);
      } else {
        const r = await createVariant(planId, {
          local_date: date, source, source_day_id: source === 'copy_day' ? sourceDay : null, name: name.trim() || undefined,
          reason, conditions: conditions(), also_dates: [...also], scaffold: useScaffold,
        });
        onDone(r.variants[0]?.day_id ?? null);
      }
    } catch (err) {
      setError(errorDetailMessage(err, editing ? '案を変えられませんでした' : '案を作れませんでした'));
      setBusy(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={editing ? `${editing.label} ${editing.name}を変える` : `案を作る · ${dateLabel}`} size="lg">
      <form onSubmit={submit} data-testid="variant-form">
        <Modal.Body>
          <div className="space-y-4">
            {!editing && (
              <fieldset className="tc-variant-field">
                <legend className="tc-variant-flabel">元にする</legend>
                <label className={`tc-variant-radio${source === 'copy_active' ? ' is-on' : ''}`}>
                  <input type="radio" name="variant-src" checked={source === 'copy_active'} onChange={() => setSource('copy_active')} />
                  この日の今の案を写す<span className="tc-variant-hint">予定・区間・エリア・予約のつながりを写す</span>
                </label>
                <label className={`tc-variant-radio${source === 'copy_day' ? ' is-on' : ''}`}>
                  <input type="radio" name="variant-src" checked={source === 'copy_day'} onChange={() => setSource('copy_day')}
                    disabled={otherDays.length === 0} />
                  別の日を写す
                  <select className="tc-variant-select" aria-label="写す日" value={sourceDay} disabled={source !== 'copy_day'}
                    onChange={(e) => setSourceDay(e.target.value)}>
                    {otherDays.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
                  </select>
                </label>
                <label className={`tc-variant-radio${source === 'blank' ? ' is-on' : ''}`}>
                  <input type="radio" name="variant-src" checked={source === 'blank'} onChange={() => setSource('blank')} />
                  白紙から
                </label>
              </fieldset>
            )}
            <div>
              <label className="tc-variant-flabel" htmlFor="variant-name">名前</label>
              <input id="variant-name" className="tc-variant-input" value={name} maxLength={40} placeholder="例: 雨の日"
                onChange={(e) => setName(e.target.value)} />
              {!editing && <p className="tc-variant-hint">記号(B・C…)は自動で付きます。1 日に 5 案まで</p>}
            </div>
            <fieldset className="tc-variant-field">
              <legend className="tc-variant-flabel">理由</legend>
              <div className="tc-variant-reasons">
                {REASONS.map(([k, label]) => (
                  <button key={k} type="button" className={`tc-focus-ring tc-variant-reason${reason === k ? ' is-on' : ''}`} aria-pressed={reason === k}
                    onClick={() => setReason(reason === k ? null : k)} data-testid={`variant-reason-${k}`}>{label}</button>
                ))}
              </div>
            </fieldset>
            <fieldset className="tc-variant-field">
              <legend className="tc-variant-flabel">条件</legend>
              <div className="tc-variant-grid">
                <label className="tc-variant-small">人数
                  <input type="number" min={1} max={99} className="tc-variant-input" value={party} onChange={(e) => setParty(e.target.value)}
                    placeholder="旅行の人数のまま" />
                </label>
                <label className="tc-variant-small">移動の既定
                  <select className="tc-variant-input" value={transport} onChange={(e) => setTransport(e.target.value)}>
                    {TRANSPORTS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
                  </select>
                </label>
              </div>
              <label className="tc-variant-check"><input type="checkbox" checked={indoor} onChange={(e) => setIndoor(e.target.checked)} />屋内の予定を優先する</label>
            </fieldset>
            {canScaffold && (
              <fieldset className="tc-variant-field" data-testid="variant-scaffold">
                <legend className="tc-variant-flabel">たたき台</legend>
                <label className="tc-variant-check">
                  <input type="checkbox" checked={scaffold} onChange={(e) => setScaffold(e.target.checked)} data-testid="variant-scaffold-on" />
                  {SCAFFOLD_TEXT[reason as keyof typeof SCAFFOLD_TEXT]}
                </label>
                {scaffold && reason === 'delay' && (
                  <div className="tc-variant-grid">
                    <label className="tc-variant-small">ずらす分
                      <input type="number" min={15} max={720} step={15} className="tc-variant-input" value={delayMin}
                        onChange={(e) => setDelayMin(e.target.value)} data-testid="variant-delay-min" />
                    </label>
                    <label className="tc-variant-small">この時刻から後(空なら全部)
                      <input type="time" className="tc-variant-input" value={delayAfter} onChange={(e) => setDelayAfter(e.target.value)} />
                    </label>
                  </div>
                )}
                {scaffold && reason === 'fatigue' && (
                  <label className="tc-variant-small">1 日の予定の上限
                    <input type="number" min={1} max={10} className="tc-variant-input" value={maxEvents}
                      onChange={(e) => setMaxEvents(e.target.value)} data-testid="variant-max-events" />
                  </label>
                )}
                <p className="tc-variant-hint">確定の予定は動かしません。予定は消さず、外す候補には印を付けます</p>
              </fieldset>
            )}
            {!editing && otherDays.length > 0 && (
              <fieldset className="tc-variant-field">
                <legend className="tc-variant-flabel">まとめて作る(案の組として一緒に切り替え)</legend>
                <div className="tc-variant-reasons">
                  {otherDays.map((d) => (
                    <label key={d.id} className="tc-variant-check">
                      <input type="checkbox" checked={also.has(d.date)}
                        onChange={() => setAlso((s) => { const n = new Set(s); if (n.has(d.date)) n.delete(d.date); else n.add(d.date); return n; })} />
                      {d.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          </div>
        </Modal.Body>
        <Modal.Footer>
          <Button type="button" variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button type="submit" variant="primary" loading={busy} data-testid="variant-submit">{editing ? '保存' : '案を作る'}</Button>
        </Modal.Footer>
      </form>
    </Modal>
  );
};

export default CreateVariantDialog;
