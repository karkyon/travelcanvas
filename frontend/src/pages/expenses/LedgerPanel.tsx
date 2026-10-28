/**
 * [Gate G5] 費用の「記録」タブ: FIN-01 為替の記録・予算の版 / FIN-02 端数の規則・精算の締め。
 *
 * - 為替: 1 外貨 = いくら(基準通貨)かを、出典・基準日つきで記録する。支出はこの記録を選んで換算でき、
 *   後で新しいレートを足しても、記録した支出の換算は変わらない。予約額の換算にも最新の記録を使う。
 * - 予算の版: 当初(1つだけ)・更新・確定(確定した予約)・実績を、その時点の写しとして残す(後から変わらない)。
 * - 端数の規則: 換算の丸め方と、分担で割り切れない端数を誰に配るか(これから登録・変更する支出に使う)。
 * - 締め: 締めると支出・精算・設定を変えられない。解除は所有者だけ(理由が必要)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Card from '@/components/common/Card';
import {
  createBudgetVersion, createFxRate, getBudgetVersions, getFinanceSettingsG5, getFxRates, lockFinance, putRoundingPolicy,
  unlockFinance,
} from '@/services/api/g5';
import type {
  BudgetVersion, BudgetVersionKind, FinanceSettingsG5, FxRate, RemainderTo, RoundingMode,
} from '@/services/api/types/g5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { formatMoney } from './financeModel';
import { REMAINDER_LABEL, ROUNDING_LABEL, VERSION_LABEL } from './ledgerLabels';

interface Props {
  planId: string;
  canEdit: boolean;
  isOwner: boolean;
  baseCurrency: string;
  currencies: string[];
  /** 締め・規則を変えた後に、親の画面(支出・精算)を読み直す */
  onChanged: () => void;
}

const inputClass = 'w-full border rounded-lg px-3 py-2';
const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';

const LedgerPanel: React.FC<Props> = ({ planId, canEdit, isOwner, baseCurrency, currencies, onChanged }) => {
  const [settings, setSettings] = useState<FinanceSettingsG5 | null>(null);
  const [rates, setRates] = useState<FxRate[]>([]);
  const [versions, setVersions] = useState<BudgetVersion[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const foreign = currencies.filter((c) => c !== baseCurrency);
  const [rateForm, setRateForm] = useState({ currency: foreign[0] ?? 'USD', rate: '', rate_date: '', source: '' });
  const [policy, setPolicy] = useState<{ rounding_mode: RoundingMode; remainder_to: RemainderTo }>(
    { rounding_mode: 'half_up', remainder_to: 'largest' });
  const [unlockReason, setUnlockReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, r, v] = await Promise.all([getFinanceSettingsG5(planId), getFxRates(planId), getBudgetVersions(planId)]);
      setSettings(s);
      setPolicy({ rounding_mode: s.rounding_mode, remainder_to: s.remainder_to });
      setRates(r);
      setVersions(v);
    } catch (e) {
      setError(errorDetailMessage(e, '記録を取得できませんでした'));
    }
  }, [planId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn: () => Promise<unknown>, ok: string, fallback: string, refreshParent = false) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(ok);
      await load();
      if (refreshParent) onChanged();
    } catch (e) {
      setError(errorDetailMessage(e, fallback));
    } finally {
      setBusy(false);
    }
  };

  const locked = !!settings?.locked_at;

  return (
    <div className="space-y-4">
      {error && <p role="alert" className="p-3 rounded-lg bg-red-50 text-red-800 text-sm">{error}</p>}
      {notice && <p role="status" className="p-3 rounded-lg bg-green-50 text-green-900 text-sm">{notice}</p>}

      <Card padding="md">
        <section aria-labelledby="ledger-lock-heading">
          <h2 id="ledger-lock-heading" className="text-lg font-semibold text-ink-900 mb-2">精算の締め</h2>
          {locked ? (
            <>
              <p className="text-sm text-ink-900 mb-3">
                精算を締めています(支出・精算・端数の規則は変えられません)。
              </p>
              {isOwner && (
                <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => {
                  e.preventDefault();
                  void run(() => unlockFinance(planId, unlockReason.trim()), '締めを解除しました', '締めを解除できませんでした', true)
                    .then(() => setUnlockReason(''));
                }}>
                  <div className="flex-1 min-w-48">
                    <label htmlFor="unlock-reason" className="block text-sm font-medium text-ink-900 mb-1">解除する理由</label>
                    <input id="unlock-reason" className={inputClass} maxLength={200} value={unlockReason}
                      onChange={(e) => setUnlockReason(e.target.value)} />
                  </div>
                  <button type="submit" disabled={busy || !unlockReason.trim()} className={`${btn} border border-gray-400 text-ink-900`}>
                    締めを解除する
                  </button>
                </form>
              )}
            </>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-ink-900">精算が終わったら締めると、後から金額が変わりません。</p>
              {canEdit && (
                <button type="button" disabled={busy} className={`${btn} bg-blue-700 text-white`}
                  onClick={() => {
                    if (!window.confirm('精算を締めますか? 締めた後は、所有者が解除するまで支出・精算を変えられません。')) return;
                    void run(() => lockFinance(planId), '精算を締めました', '精算を締められませんでした', true);
                  }}>
                  精算を締める
                </button>
              )}
            </div>
          )}
        </section>
      </Card>

      <Card padding="md">
        <section aria-labelledby="ledger-rounding-heading">
          <h2 id="ledger-rounding-heading" className="text-lg font-semibold text-ink-900 mb-2">端数の規則</h2>
          <p className="text-sm text-ink-700 mb-3">これから登録・変更する支出に使います(登録済みの支出は変わりません)。</p>
          <form className="grid grid-cols-1 sm:grid-cols-3 gap-3 items-end" onSubmit={(e) => {
            e.preventDefault();
            if (!settings) return;
            void run(() => putRoundingPolicy(planId, policy, settings.revision), '端数の規則を保存しました', '端数の規則を保存できませんでした', true);
          }}>
            <div>
              <label htmlFor="rounding-mode" className="block text-sm font-medium text-ink-900 mb-1">換算の丸め方</label>
              <select id="rounding-mode" className={inputClass} value={policy.rounding_mode} disabled={!canEdit || locked}
                onChange={(e) => setPolicy({ ...policy, rounding_mode: e.target.value as RoundingMode })}>
                {(Object.keys(ROUNDING_LABEL) as RoundingMode[]).map((k) => <option key={k} value={k}>{ROUNDING_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="remainder-to" className="block text-sm font-medium text-ink-900 mb-1">割り切れない端数</label>
              <select id="remainder-to" className={inputClass} value={policy.remainder_to} disabled={!canEdit || locked}
                onChange={(e) => setPolicy({ ...policy, remainder_to: e.target.value as RemainderTo })}>
                {(Object.keys(REMAINDER_LABEL) as RemainderTo[]).map((k) => <option key={k} value={k}>{REMAINDER_LABEL[k]}</option>)}
              </select>
            </div>
            {canEdit && (
              <button type="submit" disabled={busy || locked || !settings} className={`${btn} bg-blue-700 text-white`}>
                端数の規則を保存
              </button>
            )}
          </form>
        </section>
      </Card>

      <Card padding="md">
        <section aria-labelledby="ledger-rates-heading">
          <h2 id="ledger-rates-heading" className="text-lg font-semibold text-ink-900 mb-2">為替の記録</h2>
          {rates.length === 0 ? (
            <p className="text-sm text-ink-700 mb-3">まだ記録はありません。</p>
          ) : (
            <ul className="mb-3 divide-y" aria-label="為替の記録">
              {rates.map((r) => (
                <li key={r.id} className="py-2 text-sm text-ink-900">
                  1 {r.currency} = {r.rate} {r.base_currency}(基準日 {r.rate_date}・出典 {r.source})
                </li>
              ))}
            </ul>
          )}
          {canEdit && foreign.length > 0 && (
            <form className="grid grid-cols-1 sm:grid-cols-5 gap-2 items-end" onSubmit={(e) => {
              e.preventDefault();
              void run(() => createFxRate(planId, {
                currency: rateForm.currency, rate: rateForm.rate.trim(), rate_date: rateForm.rate_date,
                source: rateForm.source.trim() || '手入力',
              }), '為替を記録しました', '為替を記録できませんでした', true).then(() => setRateForm({ ...rateForm, rate: '', source: '' }));
            }}>
              <div>
                <label htmlFor="fx-currency" className="block text-sm font-medium text-ink-900 mb-1">通貨</label>
                <select id="fx-currency" className={inputClass} value={rateForm.currency}
                  onChange={(e) => setRateForm({ ...rateForm, currency: e.target.value })}>
                  {foreign.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="fx-rate" className="block text-sm font-medium text-ink-900 mb-1">1 単位 = ? {baseCurrency}</label>
                <input id="fx-rate" inputMode="decimal" className={inputClass} value={rateForm.rate}
                  onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} />
              </div>
              <div>
                <label htmlFor="fx-date" className="block text-sm font-medium text-ink-900 mb-1">基準日</label>
                <input id="fx-date" type="date" className={inputClass} value={rateForm.rate_date}
                  onChange={(e) => setRateForm({ ...rateForm, rate_date: e.target.value })} />
              </div>
              <div>
                <label htmlFor="fx-source" className="block text-sm font-medium text-ink-900 mb-1">出典</label>
                <input id="fx-source" className={inputClass} maxLength={100} placeholder="手入力" value={rateForm.source}
                  onChange={(e) => setRateForm({ ...rateForm, source: e.target.value })} />
              </div>
              <button type="submit" disabled={busy || !rateForm.rate.trim() || !rateForm.rate_date}
                className={`${btn} bg-blue-700 text-white`}>
                為替を記録
              </button>
            </form>
          )}
        </section>
      </Card>

      <Card padding="md">
        <section aria-labelledby="ledger-versions-heading">
          <h2 id="ledger-versions-heading" className="text-lg font-semibold text-ink-900 mb-2">予算の版</h2>
          {versions.length === 0 ? (
            <p className="text-sm text-ink-700 mb-3">まだ版はありません。</p>
          ) : (
            <ul className="mb-3 divide-y" aria-label="予算の版">
              {versions.map((v) => (
                <li key={v.id} className="py-2 text-sm text-ink-900">
                  <span className="font-medium">{VERSION_LABEL[v.kind]}: {v.label}</span>
                  {' '}合計 {formatMoney(v.total_amount, v.base_currency)}
                  {Object.keys(v.unconverted).length > 0 && (
                    <span className="text-amber-900">
                      (換算できない分: {Object.entries(v.unconverted).map(([c, a]) => `${c} ${String(a)}`).join('・')})
                    </span>
                  )}
                  {v.created_at && <span className="text-ink-700"> ・{v.created_at.slice(0, 10)}</span>}
                </li>
              ))}
            </ul>
          )}
          {canEdit && (
            <div className="flex flex-wrap gap-2">
              {(Object.keys(VERSION_LABEL) as BudgetVersionKind[])
                .filter((k) => k !== 'initial' || !versions.some((v) => v.kind === 'initial'))
                .map((k) => (
                  <button key={k} type="button" disabled={busy} className={`${btn} border border-gray-400 text-ink-900`}
                    onClick={() => void run(() => createBudgetVersion(planId, { kind: k }), `「${VERSION_LABEL[k]}」の版を残しました`,
                      '予算の版を残せませんでした')}>
                    「{VERSION_LABEL[k]}」の版を残す
                  </button>
                ))}
            </div>
          )}
        </section>
      </Card>
    </div>
  );
};

export default LedgerPanel;
