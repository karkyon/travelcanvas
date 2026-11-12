/**
 * [Gate PlanB] 旅程の日の見出しの下に置く: 案のタブ・控えの案の帯と、作る・変える・切り替える・比べるのダイアログ
 */
import React, { useEffect, useState } from 'react';
import { useToast } from '@/components/common/toastContext';
import { deleteVariant, getWeather, patchVariant, type Forecast, type VariantReason, type VariantSummary } from '@/services/api/dayVariants';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import VariantBar from './VariantBar';
import CreateVariantDialog from './CreateVariantDialog';
import SwitchVariantDialog from './SwitchVariantDialog';
import CompareVariantsDialog from './CompareVariantsDialog';
import IndoorDialog from './IndoorDialog';
import AiCheckDialog from './AiCheckDialog';
import { activeOf } from './variantModel';

interface Props {
  planId: string;
  revision: number;
  date: string;
  dateLabel: string;
  canEdit: boolean;
  variants: VariantSummary[];
  openId: string | null;
  checkSum: { ok: number; warn: number; bad: number } | null;
  otherDays: { id: string; date: string; label: string }[];
  onOpen: (dayId: string | null) => void;
  /** 旅行の版が変わった(作った・切り替えた・消した)。旅程を読み直す */
  onChanged: () => Promise<void> | void;
}

const VariantPanel: React.FC<Props> = ({ planId, revision, date, dateLabel, canEdit, variants, openId, checkSum, otherDays, onOpen, onChanged }) => {
  const { addToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<VariantSummary | null>(null);
  const [switching, setSwitching] = useState(false);
  const [comparing, setComparing] = useState(false);
  const [preset, setPreset] = useState<VariantReason | null>(null);
  const [indoor, setIndoor] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [forecast, setForecast] = useState<Forecast | null>(null);
  // [PlanB-Weather] この日の予報(案を作った・切り替えた時も読み直す)
  useEffect(() => {
    let live = true;
    setForecast(null);
    getWeather(planId, date).then((r) => { if (live) setForecast(r.forecasts[0] ?? null); }).catch(() => { if (live) setForecast(null); });
    return () => { live = false; };
  }, [planId, date, revision]);
  const open = variants.find((v) => v.day_id === openId) ?? null;
  const active = activeOf(variants) ?? null;
  const fail = (e: unknown, msg: string) => addToast({ type: 'error', message: errorDetailMessage(e, msg) });
  return (
    <>
      <VariantBar variants={variants} openId={openId} canEdit={canEdit} checkSummary={checkSum} onOpen={onOpen}
        forecast={forecast} onCreateRain={() => { setPreset('rain'); setCreating(true); }}
        onIndoor={() => setIndoor(true)} onAiCheck={() => setAiOpen(true)}
        onCreate={() => { setPreset(null); setCreating(true); }} onSwitch={() => setSwitching(true)} onCompare={() => setComparing(true)}
        onCheck={() => setSwitching(true)} onRename={(v) => setEditing(v)}
        onArchive={async (v) => {
          try {
            await patchVariant(planId, v.day_id, revision, { status: v.status === 'archived' ? 'standby' : 'archived' });
            addToast({ type: 'success', message: v.status === 'archived' ? `${v.label} ${v.name}を控えに戻しました` : `${v.label} ${v.name}をしまいました` });
            await onChanged();
          } catch (e) { fail(e, '案を変えられませんでした'); }
        }}
        onDelete={async (v) => {
          if (!window.confirm(`${v.label} ${v.name}を消しますか?(直後なら「元に戻す」で戻せます)`)) return;
          try {
            await deleteVariant(planId, v.day_id, revision);
            onOpen(null);
            addToast({ type: 'success', message: `${v.label} ${v.name}を消しました(「元に戻す」で戻せます)` });
            await onChanged();
          } catch (e) { fail(e, '案を消せませんでした'); }
        }} />
      <CreateVariantDialog planId={planId} isOpen={creating || Boolean(editing)} date={date} dateLabel={dateLabel} otherDays={otherDays}
        revision={revision} editing={editing} presetReason={preset} onClose={() => { setCreating(false); setEditing(null); }}
        onDone={async (dayId) => {
          const was = editing;
          setCreating(false);
          setEditing(null);
          addToast({ type: 'success', message: was ? '案を保存しました' : '案を作りました。今の案は変わっていません' });
          await onChanged();
          if (dayId) onOpen(dayId);
        }} />
      <SwitchVariantDialog planId={planId} isOpen={switching} target={open} active={active} revision={revision}
        onClose={() => setSwitching(false)}
        onSwitched={async () => {
          setSwitching(false);
          addToast({ type: 'success', message: `${open?.label ?? ''} ${open?.name ?? ''}に切り替えました(「元に戻す」で戻せます)` });
          onOpen(null);
          await onChanged();
        }} />
      <IndoorDialog planId={planId} isOpen={indoor} variant={open} revision={revision} onClose={() => setIndoor(false)}
        onDone={async () => {
          setIndoor(false);
          addToast({ type: 'success', message: '控えの案の予定を入れ替えました(「元に戻す」で戻せます)' });
          await onChanged();
        }} />
      <AiCheckDialog planId={planId} isOpen={aiOpen} variant={open} onClose={() => setAiOpen(false)} />
      <CompareVariantsDialog planId={planId} isOpen={comparing} left={active} right={open} canSwitch={canEdit}
        onClose={() => setComparing(false)} onSwitch={() => { setComparing(false); setSwitching(true); }} />
    </>
  );
};

export default VariantPanel;
