/**
 * [Gate G7] MOVE-03 移動・滞在の既定(backend/app/api/v1/movement.py)。
 *
 * 終了時刻の無い予定の「終わり」を見積もる既定の滞在・歩く速さの見込み・休憩の規則・同行者の属性を旅行ごとに決める。
 * 見積もりで出た問題は検証の結果に「見積もり」と書かれる(確かめた事実と区別する)。保存すると検証の結果は古くなる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Footprints } from 'lucide-react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { getMovementSettings, saveMovementSettings } from '@/services/api/g7';
import type { MovementSettings, MovementSettingsValue, MovementPace } from '@/services/api/types/g7';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { draftFrom, draftToSettings, type MovementDraft } from './movementModel';

interface Props {
  planId: string;
  onSaved?: () => void;
}

const input = 'w-24 border rounded-lg px-2 py-1';

const MovementSettingsPanel: React.FC<Props> = ({ planId, onSaved }) => {
  const [data, setData] = useState<MovementSettings | null>(null);
  const [draft, setDraft] = useState<MovementDraft | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await getMovementSettings(planId);
      setData(d);
      setDraft(draftFrom(d.settings));
    } catch (e) {
      setError(errorDetailMessage(e, '移動・滞在の既定を読み込めませんでした'));
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const set = <K extends keyof MovementDraft>(key: K, value: MovementDraft[K]) =>
    setDraft((d) => (d ? { ...d, [key]: value } : d));

  const save = async () => {
    if (!data || !draft) return;
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      let settings: Partial<MovementSettingsValue>;
      try {
        settings = draftToSettings(draft);
      } catch (e) {
        setError((e as Error).message);
        return;
      }
      const saved = await saveMovementSettings(planId, settings, data.revision);
      setData(saved);
      setDraft(draftFrom(saved.settings));
      setMessage('保存しました。検証をやり直すと、新しい既定で判定します。');
      onSaved?.();
    } catch (e) {
      setError(errorDetailMessage(e, '保存できませんでした。読み込み直してから、もう一度保存してください'));
    } finally {
      setBusy(false);
    }
  };

  const eff = data?.effective;
  return (
    <Card padding="md" className="mb-6">
      <section aria-labelledby="movement-heading">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="movement-heading" className="text-lg font-semibold text-ink-900 flex items-center gap-2">
              <Footprints size={18} className="text-blue-700" aria-hidden="true" />移動・滞在の既定
            </h2>
            <p className="text-xs text-ink-700 mt-0.5">
              終了時刻が無い予定の滞在を見積もり、休憩の無い連続・長すぎる1日・最終の便に間に合うかを確かめます。
            </p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
            {open ? '閉じる' : '既定を見る・変える'}
          </Button>
        </div>
        {eff && (
          <p className="mt-2 text-sm text-ink-900" data-testid="movement-summary">
            {`休憩なしは${eff.max_continuous_minutes}分まで・1日は${Math.round(eff.max_day_minutes / 60)}時間まで・`
              + `${eff.break_minutes}分以上の空きか食事を休憩とみなします`}
            {data?.is_default ? '(既定のまま)' : ''}
          </p>
        )}
        {data && !eff && <p className="mt-2 text-sm text-amber-900">見積もりを使わない設定です(終了時刻のある予定だけで判定します)。</p>}
        {eff?.notes.map((n) => <p key={n} className="text-xs text-ink-700">{n}</p>)}
        {error && <div className="mt-3 p-2 rounded-sm bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
        {message && <div className="mt-3 p-2 rounded-sm bg-green-50 text-green-900 text-sm" role="status">{message}</div>}

        {open && data && draft && (
          <form className="mt-4 space-y-4" onSubmit={(e) => { e.preventDefault(); void save(); }}>
            <label className="flex items-center gap-2 text-sm text-ink-900">
              <input type="checkbox" checked={draft.enabled} disabled={!data.can_edit}
                onChange={(e) => set('enabled', e.target.checked)} />
              既定の滞在で見積もって確かめる
            </label>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-ink-900">歩く速さの見込み</legend>
              <div className="flex flex-wrap gap-3">
                {data.paces.map((p) => (
                  <label key={p.key} className="flex items-center gap-1 text-sm text-ink-900">
                    <input type="radio" name="movement-pace" value={p.key} checked={draft.pace === p.key}
                      disabled={!data.can_edit} onChange={() => set('pace', p.key as MovementPace)} />
                    {`${p.label}(滞在×${p.stay_factor}・連続${p.max_continuous}分)`}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium text-ink-900">同行者</legend>
              <label className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" checked={draft.withChildren} disabled={!data.can_edit}
                  onChange={(e) => set('withChildren', e.target.checked)} />
                子ども連れ
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-900">
                <input type="checkbox" checked={draft.withSeniors} disabled={!data.can_edit}
                  onChange={(e) => set('withSeniors', e.target.checked)} />
                高齢の方と一緒
              </label>
              <label className="flex items-center gap-2 text-sm text-ink-900">
                人数
                <input type="number" min={1} max={50} className={input} value={draft.size} disabled={!data.can_edit}
                  onChange={(e) => set('size', e.target.value)} aria-describedby="movement-size-help" />
              </label>
              <p id="movement-size-help" className="text-xs text-ink-700">空のままなら参加者の数を使います(思い出からの提案で、同じ人数の旅行を優先します)。</p>
            </fieldset>
            <fieldset>
              <legend className="text-sm font-medium text-ink-900">種類ごとの既定の滞在(分)</legend>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mt-1">
                {data.event_types.filter((t) => t.estimated).map((t) => (
                  <label key={t.key} className="flex items-center justify-between gap-2 text-sm text-ink-900">
                    {t.label}
                    <input type="number" min={5} max={600} className={input} value={draft.stays[t.key] ?? ''}
                      disabled={!data.can_edit} aria-label={`${t.label}の既定の滞在(分)`}
                      onChange={(e) => set('stays', { ...draft.stays, [t.key]: e.target.value })} />
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid sm:grid-cols-2 gap-2">
              <label className="flex items-center justify-between gap-2 text-sm text-ink-900">
                休憩とみなす空き(分)
                <input type="number" min={5} max={120} className={input} value={draft.breakMinutes}
                  disabled={!data.can_edit} onChange={(e) => set('breakMinutes', e.target.value)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm text-ink-900">
                休憩なしで続けてよい時間(分)
                <input type="number" min={30} max={720} className={input} value={draft.maxContinuous}
                  placeholder="既定" disabled={!data.can_edit} onChange={(e) => set('maxContinuous', e.target.value)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm text-ink-900">
                1日の活動の上限(時間)
                <input type="number" min={2} max={18} className={input} value={draft.maxDayHours}
                  placeholder="既定" disabled={!data.can_edit} onChange={(e) => set('maxDayHours', e.target.value)} />
              </label>
              <label className="flex items-center justify-between gap-2 text-sm text-ink-900">
                最終の便の前の余裕(分)
                <input type="number" min={0} max={120} className={input} value={draft.margin}
                  disabled={!data.can_edit} onChange={(e) => set('margin', e.target.value)} />
              </label>
            </div>
            {data.can_edit ? (
              <Button type="submit" variant="primary" size="sm" loading={busy}>既定を保存</Button>
            ) : (
              <p className="text-sm text-ink-700">閲覧のみの参加者は変えられません。</p>
            )}
          </form>
        )}
      </section>
    </Card>
  );
};

export default MovementSettingsPanel;
