/**
 * [Gate Remaining-7] FR-011 Gmail の連携(読み取りだけ・押した時だけ取り込む)。
 *
 * 自分の Google アカウントで許可すると、予約らしいメール(直近 30 日・最大 20 通)を読み、下の一覧に候補を作る
 * (確定は人が確かめてから。自動では予約を作らない)。同じメールは 2 回取り込まない。外すと Google の許可も取り消す。
 * 管理者が Google の OAuth クライアントを登録していない環境では案内だけ出す。
 */
import React, { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import type { GmailStatus } from '@/services/api/remaining6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';

const r6 = () => import('@/services/api/remaining6');

const RETURN_MESSAGE: Record<string, string> = {
  connected: 'Gmail とつなぎました。「Gmail から取り込む」を押すと予約のメールを読みます',
  denied: 'Gmail の許可がされませんでした',
  invalid_state: '連携の手続きが切れました。もう一度つないでください',
  gmail_scope_missing: 'Gmail を読む許可がありませんでした(許可の画面で Gmail に印を付けてください)',
};

const GmailCard: React.FC<{ planId: string; onImported?: () => void }> = ({ planId, onImported }) => {
  const [params] = useSearchParams();
  const [st, setSt] = useState<GmailStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(() => {
    const k = params.get('gmail');
    return k ? (RETURN_MESSAGE[k] ?? 'Gmail とつなげませんでした。もう一度試してください') : null;
  });
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    r6().then((m) => m.getGmailStatus()).then((x) => { if (alive) setSt(x); }).catch(() => { if (alive) setSt(null); });
    return () => { alive = false; };
  }, []);

  const act = async (fn: () => Promise<void>, fail: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); } catch (e) { setErr(errorDetailMessage(e, fail)); } finally { setBusy(false); }
  };

  if (!st) return null;
  return (
    <Card className="mt-4 p-4" data-testid="gmail-card">
      <h2 className="text-lg font-semibold text-ink-900">Gmail から取り込む</h2>
      {!st.available ? (
        <p className="mt-1 text-sm text-ink-700">この環境では Gmail の連携が使えません(管理者が Google の設定を登録すると使えます)。転送のアドレス・本文の貼り付けで取り込めます。</p>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink-700">
            {`あなたの Gmail から予約らしいメール(直近 30 日・最大 ${st.max_messages} 通)を、押した時だけ読みます。読むだけで、メールを変えたり送ったりしません。本文は保存しません。`}
          </p>
          {msg && <p role="status" className="mt-2 text-sm text-green-900">{msg}</p>}
          {err && <p role="alert" className="mt-2 text-sm text-danger">{err}</p>}
          {st.connected ? (
            <>
              <p className="mt-2 text-sm text-ink-900" data-testid="gmail-connected">
                {`つないでいる: ${st.google_email ?? 'Google アカウント'}`}
                {st.last_sync_at && `・前に読んだ時 ${new Date(st.last_sync_at).toLocaleString('ja-JP')}`}
                {`・取り込んだ数 ${st.imported_count}`}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="sm" disabled={busy} onClick={() => void act(async () => {
                  const r = await (await r6()).syncGmail(planId);
                  setSt(r);
                  setMsg(r.messages === 0 ? '新しい予約のメールはありませんでした' : `${r.messages} 通を読み、${r.jobs} 件の読み取りを作りました(下の一覧で確かめてください)`);
                  if (r.jobs > 0) onImported?.();
                }, 'Gmail を読めませんでした')}>{busy ? '読んでいます…' : 'Gmail から取り込む'}</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void act(async () => {
                  setSt(await (await r6()).disconnectGmail());
                  setMsg('Gmail の連携を外しました');
                }, '連携を外せませんでした')}>連携を外す</Button>
              </div>
            </>
          ) : (
            <Button size="sm" className="mt-2" disabled={busy} onClick={() => void act(async () => {
              const { authorize_url: url } = await (await r6()).connectGmail(planId);
              const safe = safeExternalUrl(url);
              if (!safe || !safe.startsWith('https://accounts.google.com/')) throw new Error('連携の画面を開けませんでした');
              window.location.assign(safe);
            }, 'Gmail とつなげませんでした')}>Gmail とつなぐ</Button>
          )}
        </>
      )}
    </Card>
  );
};

export default GmailCard;
