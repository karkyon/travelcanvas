/**
 * [Gate Remaining-3] FR-011 予約メールの転送アドレス。
 *
 * 予約の確認メールをこのアドレスへ転送すると、項目の候補を作る(確定は下の一覧で確かめてから。自動では予約を作らない)。
 * アドレスは旅行・人ごと。作り直すと前のアドレスは使えない。管理者が受信の設定をしていない環境では案内だけ出す。
 */
import React, { useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import {
  createInboundMail, getInboundMail, revokeInboundMail, type InboundMailInfo,
} from '@/services/api/remaining2';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const InboundMailCard: React.FC<{ planId: string }> = ({ planId }) => {
  const [info, setInfo] = useState<InboundMailInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    getInboundMail(planId).then((x) => { if (alive) setInfo(x); })
      .catch(() => { if (alive) setInfo(null); });
    return () => { alive = false; };
  }, [planId]);

  const run = async (fn: () => Promise<InboundMailInfo>) => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      setInfo(await fn());
    } catch (e) {
      setError(errorDetailMessage(e, '転送のアドレスを変えられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!info?.address) return;
    try {
      await navigator.clipboard.writeText(info.address);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  if (!info) return null;
  return (
    <Card padding="md" className="mb-4">
      <section aria-labelledby="inbound-mail-heading" data-testid="inbound-mail">
        <h2 id="inbound-mail-heading" className="text-lg font-semibold text-ink-900">予約メールを転送して取り込む</h2>
        {!info.configured ? (
          <p className="text-sm text-ink-700 mt-1">
            この環境ではメールの転送を受け付けていません(管理者の設定が必要です)。メールの本文を貼り付けるか、.eml・PDF のファイルで取り込めます。
          </p>
        ) : info.address ? (
          <>
            <p className="text-sm text-ink-700 mt-1">
              予約の確認メールを次のアドレスへ転送すると、項目を読み取って下の一覧に入れます(確かめてから確定。自動では予約を作りません)。PDF の添付も読みます。
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="px-2 py-1 rounded-sm bg-cloud-100 text-ink-900 break-all" data-testid="inbound-mail-address">{info.address}</code>
              <Button variant="outline" size="sm" onClick={() => void copy()}>{copied ? '写しました' : '写す'}</Button>
            </div>
            <p className="text-xs text-ink-700 mt-2">
              {`届いたメール ${info.received_count} 通${info.last_received_at ? `(最後 ${info.last_received_at.slice(0, 16).replace('T', ' ')})` : ''} ・ 1日 ${info.daily_limit} 通まで。`}
              アドレスを知っている人は誰でも送れるため、人に教えないでください。
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" loading={busy} onClick={() => void run(() => createInboundMail(planId))}>作り直す(前のアドレスは使えなくなる)</Button>
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void run(() => revokeInboundMail(planId))}>止める</Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-ink-700 mt-1">
              この旅行専用の転送アドレスを作ると、予約の確認メールを転送するだけで項目を読み取れます(確定は確かめてから)。
            </p>
            <Button className="mt-2" variant="outline" size="sm" loading={busy}
              onClick={() => void run(() => createInboundMail(planId))}>転送アドレスを作る</Button>
          </>
        )}
        {error && <p className="mt-2 p-2 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</p>}
      </section>
    </Card>
  );
};

export default InboundMailCard;
