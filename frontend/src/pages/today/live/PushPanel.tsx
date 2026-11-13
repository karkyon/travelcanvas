/**
 * [Gate TDay-Push] 当日の設定の「端末への通知」。画面を閉じていても、出発の合図・雨・今日の旅程・同行者の遅れを
 * この端末へ届ける(Web Push。無料。backend の定期の処理が送る)。
 * 許可の確認は「この端末に通知を送る」を押した時だけ出す(開いただけでは聞かない)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  disablePush, enablePush, getPushConfig, pushSupport, putPushKinds, sendTestPush, syncThisDevice,
  type PushConfig, type PushKind,
} from '@/services/api/push';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { LiveSwitch } from './LivePieces';

const KIND_ROWS: { kind: PushKind; label: string; sub: string }[] = [
  { kind: 'depart', label: '出発の合図', sub: '出る15分前と、出る時刻' },
  { kind: 'rain', label: '雨の兆し', sub: '屋外の予定の2時間前から、雨の予報の時' },
  { kind: 'morning', label: '今日の旅程', sub: '最初の出発の1時間前(6時より後)' },
  { kind: 'crew', label: '同行者の遅れ', sub: '同行者の到着予定が10分以上遅い時(位置は届きません)' },
  { kind: 'notice', label: '自分あての知らせ', sub: 'メンション・返信・予約の取消期限・転送した予約メールの読み取り(題名だけ)' },
];

const SUPPORT_TEXT: Record<string, string> = {
  insecure: 'https で開いた画面でだけ使えます(ブラウザの決まり)。https の入口から開き直してください',
  ios_needs_home_screen: 'iPhone では、共有ボタン →「ホーム画面に追加」で追加したアプリから開くと使えます',
  unsupported: 'このブラウザは端末への通知に対応していません',
};

const PushPanel: React.FC = () => {
  const support = pushSupport();
  const [cfg, setCfg] = useState<PushConfig | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const c = await getPushConfig();
      setCfg(c);
      if (support === 'ok' && c.available) {
        const synced = await syncThisDevice(c).catch(() => null);
        if (synced) setCfg(synced);
        setOn(synced !== null);
      }
    } catch (e) {
      setErr(errorDetailMessage(e, '通知の設定を読めませんでした'));
    }
  }, [support]);
  useEffect(() => { void load(); }, [load]);

  const toggle = async (v: boolean) => {
    if (!cfg?.public_key) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      setCfg(v ? await enablePush(cfg.public_key) : await disablePush());
      setOn(v);
      setMsg(v ? 'この端末に通知を送ります' : 'この端末への通知をやめました');
    } catch (e) {
      setErr(e instanceof Error && !('response' in e) ? e.message : errorDetailMessage(e, '設定できませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const setKind = async (kind: PushKind, v: boolean) => {
    try {
      setCfg(await putPushKinds({ [kind]: v }));
    } catch (e) {
      setErr(errorDetailMessage(e, '保存できませんでした'));
    }
  };
  const test = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await sendTestPush();
      setCfg(r);
      setMsg(r.sent > 0 ? `${r.sent}台の端末に送りました。届かない時は端末の通知の設定を確かめてください`
        : '送れる端末がありません。「この端末に通知を送る」をオンにしてください');
    } catch (e) {
      setErr(errorDetailMessage(e, '送れませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const blocked = support !== 'ok' ? SUPPORT_TEXT[support] : cfg && !cfg.available ? 'この環境では端末への通知は使えません' : null;
  const devices = cfg?.devices.length ?? 0;
  return (
    <section aria-labelledby="tday-push-h" data-testid="today-push" style={{ marginTop: 14 }}>
      <p className="tc-live-label" id="tday-push-h">端末への通知(画面を閉じていても届く)</p>
      {blocked && <p className="tc-live-muted" role="note">{blocked}</p>}
      <LiveSwitch label="この端末に通知を送る" sub={devices ? `登録した端末 ${devices}台` : 'まだ登録した端末はありません'}
        checked={on} disabled={busy || !!blocked || !cfg} onToggle={(v) => void toggle(v)} testId="today-push-toggle" />
      {KIND_ROWS.map((r) => (
        <LiveSwitch key={r.kind} label={r.label} sub={r.sub} checked={cfg?.kinds[r.kind] ?? true}
          disabled={!cfg || !on} onToggle={(v) => void setKind(r.kind, v)} />
      ))}
      <div className="tc-live-row" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy || !on} onClick={() => void test()}>
          試しに送る
        </button>
      </div>
      {msg && <p className="tc-live-muted" role="status">{msg}</p>}
      {err && <p className="tc-live-error" role="alert">{err}</p>}
      {cfg && <p className="tc-live-muted" style={{ marginTop: 6 }}>{cfg.notice}</p>}
    </section>
  );
};

export default PushPanel;
