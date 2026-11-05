/**
 * [Gate PhotoQR] 写真投稿の QR を出す。QR の URL と確認コードは発行の応答でしか受け取れないので、画面を離れたら作り直す。
 */
import React, { useEffect, useState } from 'react';
import LocalQrCode from '@/components/share/LocalQrCode';
import { createUploadLink, getUploadLinks, revokeUploadLink } from '@/services/api/photoFeatures';
import type { UploadLink } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const PhotoQrCard: React.FC<{ planId: string }> = ({ planId }) => {
  const [link, setLink] = useState<UploadLink | null>(null);
  const [existing, setExisting] = useState<UploadLink | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    getUploadLinks(planId).then((rows) => setExisting(rows[0] ?? null)).catch(() => setExisting(null));
  }, [planId]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      setLink(await createUploadLink(planId));
      setExisting(null);
    } catch (e) {
      setError(errorDetailMessage(e, 'QR コードを作れませんでした'));
    } finally {
      setBusy(false);
    }
  };
  const stop = async () => {
    const target = link ?? existing;
    if (!target) return;
    setBusy(true);
    try {
      await revokeUploadLink(planId, target.id);
      setLink(null);
      setExisting(null);
    } catch (e) {
      setError(errorDetailMessage(e, 'QR コードを止められませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const url = link?.token ? `${window.location.origin}/u/${link.token}` : null;
  const local = /^(localhost|127\.)/.test(window.location.hostname);
  return (
    <section className="tc-card p-4 space-y-2" aria-labelledby="photo-qr-title" data-testid="photo-qr-card">
      <h2 id="photo-qr-title" className="tc-section-title">スマホから写真を送る</h2>
      <p className="text-sm text-ink-700">QR コードをスマホで読むと、アプリを入れずに写真を送れます。QR だけでは投稿できず、ログインか確認コードが必要です。</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {url && link ? (
        <div className="flex flex-wrap items-center gap-4">
          <LocalQrCode value={url} size={148} label="写真投稿のQRコード" />
          <div className="space-y-1 text-sm min-w-0">
            <p>{`有効期限 ${new Date(link.expires_at).toLocaleString('ja-JP', { dateStyle: 'medium', timeStyle: 'short' })}`}</p>
            <p>自分のスマホ用の確認コード <b className="font-mono text-lg tracking-widest" data-testid="photo-qr-code">{link.code}</b></p>
            <p className="text-xs text-ink-700">同行者は自分のアカウントでログインします(編集者以上)。確認コードは他の人に見せないでください。</p>
            {local && <p className="text-xs text-warning">今の URL は localhost なので、スマホからは開けません。同じネットワークの IP アドレスで開いてから QR を出してください。</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={() => void create()}>作り直す</button>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={() => void stop()}>停止する</button>
            </div>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {existing && <p className="w-full text-sm text-ink-700">{`発行済みの QR があります(${existing.upload_count} 枚投稿)。QR と確認コードをもう一度出すには作り直してください。`}</p>}
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" disabled={busy} onClick={() => void create()}>{existing ? 'QR コードを作り直す' : 'QR コードを出す'}</button>
          {existing && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" disabled={busy} onClick={() => void stop()}>停止する</button>}
        </div>
      )}
    </section>
  );
};

export default PhotoQrCard;
