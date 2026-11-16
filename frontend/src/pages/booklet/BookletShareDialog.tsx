/**
 * [Gate BookletShare] しおりの版の「共有」。Google マップの共有の画面と同じく、1 つのボタンから送り方を選ぶ。
 *
 * - 送るリンク: 公開ページ(ログインなしで見られる)か、編集できる同行者用(ログインして開く)を選ぶ。
 *   公開していなければ、ここで公開して URL を作れる(作成者・所有者)。公開の URL は何度開いても同じ。
 * - QR コード: 端末の中で作る(外のサービスへ URL を送らない)。画像として保存できる。
 * - メールアプリで送る: 自分のメールアプリが、宛先(所有者なら同行者のアドレス)・件名・本文・URL を入れた状態で開く。
 *   PDF はメールアプリへ自動では付けられないため、「PDF を保存」して自分で付ける。
 * - スマホで送る: 端末の共有(LINE・メールなど)へ URL を渡す。PDF のファイルを渡せる端末なら PDF も渡せる。
 * - アプリから送る: TravelCanvas がメールを送る(PDF を添付・リンク)。送り先は旅行のメンバーだけ。
 *   送信の設定が無い環境ではその旨を出す。確認用の受信箱へ送る環境では、外へ届かないことと受信箱の場所を出す。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { Download, Link2, Mail, QrCode, Send, Share2 } from 'lucide-react';
import Button from '@/components/common/Button';
import Modal from '@/components/common/Modal';
import { getCollaborators } from '@/services/api';
import { getBookletShare, sendBookletEmail } from '@/services/api/bookletShare';
import type { BookletShareInfo } from '@/services/api/bookletShare';
import { publishBookletExport } from '@/services/api/bookletWeb';
import { downloadBookletPdf, saveBlob } from '@/services/api/remaining5';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  absoluteUrl, mailtoUrl, pdfFileName, sandboxInboxUrl, shareBody, shareSubject, type ShareTarget,
} from './bookletShareModel';

type Tab = 'qr' | 'mailapp' | 'device' | 'appmail';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'qr', label: 'QR コード', icon: <QrCode size={16} aria-hidden="true" /> },
  { id: 'mailapp', label: 'メールアプリで送る', icon: <Mail size={16} aria-hidden="true" /> },
  { id: 'device', label: 'スマホで送る', icon: <Share2 size={16} aria-hidden="true" /> },
  { id: 'appmail', label: 'アプリから送る(PDF 添付)', icon: <Send size={16} aria-hidden="true" /> },
];
const ROLE_LABEL: Record<string, string> = { owner: '所有者', editor: '編集', viewer: '閲覧' };

interface Props {
  planId: string;
  exportId: string | null;
  title: string;
  isOwner: boolean;
  onClose: () => void;
  /** 公開した時(一覧の表示を更新する) */
  onPublished?: () => void;
}

const BookletShareDialog: React.FC<Props> = ({ planId, exportId, title, isOwner, onClose, onPublished }) => {
  const [info, setInfo] = useState<BookletShareInfo | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [target, setTarget] = useState<ShareTarget>('public');
  const [tab, setTab] = useState<Tab>('qr');
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [qrPng, setQrPng] = useState<string | null>(null);
  const [mates, setMates] = useState<string[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState('');
  const [attachPdf, setAttachPdf] = useState(true);
  const [webLink, setWebLink] = useState(true);
  const [appLink, setAppLink] = useState(true);
  const origin = window.location.origin;

  const load = useCallback(async () => {
    if (!exportId) return;
    setLoadError(null);
    try {
      const i = await getBookletShare(planId, exportId);
      setInfo(i);
      setTarget(i.public_path ? 'public' : 'app');
      setPicked(new Set(i.recipients.filter((r) => r.has_email).map((r) => r.user_id)));
      setAttachPdf(i.can_attach_pdf);
      setWebLink(!!i.public_path);
    } catch (e) {
      setLoadError(errorDetailMessage(e, '共有の情報を読めませんでした'));
    }
  }, [planId, exportId]);

  useEffect(() => {
    if (!exportId) return;
    setInfo(null); setNotice(null); setTab('qr'); setMessage('');
    void load();
  }, [exportId, load]);

  // 所有者は同行者のアドレスを知っている(招待した本人)ので、メールアプリの宛先に入れる。ほかの人は空のまま
  useEffect(() => {
    if (!exportId || !isOwner) { setMates([]); return; }
    let alive = true;
    getCollaborators(planId)
      .then((r) => { if (alive) setMates((r.data ?? []).filter((c) => c.status === 'accepted' && c.email).map((c) => c.email)); })
      .catch(() => { if (alive) setMates([]); });
    return () => { alive = false; };
  }, [planId, exportId, isOwner]);

  const url = useMemo(() => {
    if (!info) return null;
    if (target === 'public') return info.public_path ? absoluteUrl(origin, info.public_path) : null;
    return absoluteUrl(origin, info.app_path);
  }, [info, target, origin]);

  useEffect(() => {
    let alive = true;
    setQrPng(null);
    if (url) {
      QRCode.toDataURL(url, { width: 640, margin: 2, errorCorrectionLevel: 'M' })
        .then((d) => { if (alive) setQrPng(d); })
        .catch(() => { if (alive) setQrPng(null); });
    }
    return () => { alive = false; };
  }, [url]);

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key); setNotice(null);
    try { await fn(); } catch (e) {
      setNotice({ tone: 'error', text: errorDetailMessage(e, 'できませんでした') });
    } finally { setBusy(null); }
  };

  const publish = () => run('publish', async () => {
    if (!exportId) return;
    if (!window.confirm('この版を Web のページとして公開しますか?URL を知っている人は誰でも見られます(検索には出しません)。')) return;
    await publishBookletExport(planId, exportId);
    await load();
    setTarget('public');
    onPublished?.();
    setNotice({ tone: 'ok', text: '公開しました。このリンクを送れます。' });
  });

  const copy = () => run('copy', async () => {
    if (!url) return;
    await navigator.clipboard?.writeText(url);
    setNotice({ tone: 'ok', text: 'リンクをコピーしました。' });
  });

  const pdfBlob = async () => {
    if (!exportId) throw new Error('no export');
    return downloadBookletPdf(planId, exportId);
  };
  const savePdf = () => run('pdf', async () => {
    saveBlob(await pdfBlob(), pdfFileName(title, info?.version_no ?? 1));
  });

  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';
  const shareLink = () => run('device', async () => {
    if (!url) return;
    try {
      await navigator.share?.({ title: shareSubject(title), text: `旅のしおり「${title}」を送ります。`, url });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') throw e;
    }
  });
  const sharePdf = () => run('devicepdf', async () => {
    const file = new File([await pdfBlob()], pdfFileName(title, info?.version_no ?? 1), { type: 'application/pdf' });
    if (!navigator.canShare?.({ files: [file] })) {
      setNotice({ tone: 'error', text: 'この端末では PDF のファイルを共有できません。「PDF を保存」してから送ってください。' });
      return;
    }
    try {
      await navigator.share?.({ files: [file], title: shareSubject(title) });
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') throw e;
    }
  });

  const send = () => run('send', async () => {
    if (!exportId || !info) return;
    const r = await sendBookletEmail(planId, exportId, {
      user_ids: Array.from(picked), message, attach_pdf: attachPdf && info.can_attach_pdf,
      include_web_link: webLink && !!info.public_path, include_app_link: appLink, app_origin: origin,
    });
    const parts = [`${r.sent}人に送りました`];
    if (r.failed) parts.push(`${r.failed}人は送れませんでした`);
    if (r.skipped_no_address) parts.push(`${r.skipped_no_address}人はメールアドレスが無いため送っていません`);
    setNotice({ tone: r.failed ? 'error' : 'ok', text: `${parts.join('。')}。${r.sandbox ? '(確認用の受信箱へ送りました。外へは届いていません)' : ''}` });
  });

  const mailHref = url ? mailtoUrl(mates, shareSubject(title), shareBody(title, url, target)) : null;

  return (
    <Modal isOpen={!!exportId} onClose={onClose} title={`しおりを共有${info ? `(第${info.version_no}版)` : ''}`} size="lg">
      <Modal.Body>
        <div className="tc-bshare" data-testid="booklet-share">
          {loadError && <p className="tc-bshare__msg" data-tone="error" role="alert">{loadError}</p>}
          {!info && !loadError && <p className="m-0 text-sm text-ink-700" aria-busy="true">読み込み中…</p>}
          {info && (
            <>
              <fieldset className="tc-bshare__box">
                <legend>送るリンク</legend>
                <label className="tc-bshare__radio">
                  <input type="radio" name="bshare-target" checked={target === 'public'} onChange={() => setTarget('public')} />
                  <span><b>公開ページ</b><small>リンクを知っている人は、ログインなしで見られます(検索には出ません)</small></span>
                </label>
                <label className="tc-bshare__radio">
                  <input type="radio" name="bshare-target" checked={target === 'app'} onChange={() => setTarget('app')} />
                  <span><b>編集できる同行者用</b><small>TravelCanvas にログインして開きます(閲覧だけのメンバーは開けません)</small></span>
                </label>
                {target === 'public' && !info.public_path && (
                  <div className="tc-bshare__hint" data-testid="booklet-share-publish">
                    {info.contains_sensitive ? (
                      <p className="m-0">機密項目を含む版は公開できません。「編集できる同行者用」で送るか、機密項目を外した版を作ってください。</p>
                    ) : info.is_public && !info.public_url_recoverable ? (
                      <>
                        <p className="m-0">この版は以前の方法で公開したため、URL をここに出せません。作り直すと、前に送った URL は使えなくなります。</p>
                        {info.can_publish && <Button size="sm" variant="outline" onClick={() => void publish()} loading={busy === 'publish'}>URL を作り直す</Button>}
                      </>
                    ) : info.can_publish ? (
                      <>
                        <p className="m-0">まだ公開していません。公開すると、ログインしていない人にも送れるリンクができます。</p>
                        <Button size="sm" variant="primary" onClick={() => void publish()} loading={busy === 'publish'}>Web のページとして公開する</Button>
                      </>
                    ) : (
                      <p className="m-0">公開できるのは、版を作った人か旅行の所有者です。</p>
                    )}
                  </div>
                )}
                {url && (
                  <div className="tc-bshare__url">
                    <label htmlFor="bshare-url" className="sr-only">送るリンク</label>
                    <input id="bshare-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} data-testid="booklet-share-url" />
                    <Button size="sm" variant="outline" icon={<Link2 size={15} />} onClick={() => void copy()}>コピー</Button>
                  </div>
                )}
              </fieldset>

              <div className="tc-bshare__tabs" role="tablist" aria-label="送り方">
                {TABS.map((t) => (
                  <button key={t.id} type="button" role="tab" id={`bshare-tab-${t.id}`} aria-controls={`bshare-panel-${t.id}`}
                    aria-selected={tab === t.id} className="tc-focus-ring" onClick={() => setTab(t.id)}>
                    {t.icon}{t.label}
                  </button>
                ))}
              </div>

              <div role="tabpanel" id={`bshare-panel-${tab}`} aria-labelledby={`bshare-tab-${tab}`} className="tc-bshare__panel">
                {tab === 'qr' && (
                  url ? (
                    <div className="tc-bshare__qr">
                      {qrPng ? <img src={qrPng} alt={`しおりのリンクの QR コード(${target === 'public' ? '公開ページ' : '同行者用'})`} width={200} height={200} data-testid="booklet-share-qr" />
                        : <div className="tc-bshare__qrph" aria-hidden="true" />}
                      <div>
                        <p className="m-0 text-sm">スマホのカメラで読み取ると、しおりが開きます。印刷して配ったり、画面を見せたりできます。</p>
                        <p className="m-0 mt-1 text-xs text-ink-700">QR コードはこの端末の中で作ります(外のサービスへリンクを送りません)。</p>
                        {qrPng && (
                          <a className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" href={qrPng} download={`${pdfFileName(title, info.version_no).replace(/\.pdf$/, '')}_QR.png`}>
                            <Download size={15} aria-hidden="true" />画像を保存
                          </a>
                        )}
                      </div>
                    </div>
                  ) : <p className="m-0 text-sm">先に「送るリンク」を決めてください。</p>
                )}

                {tab === 'mailapp' && (
                  <div className="space-y-2">
                    <p className="m-0 text-sm">
                      自分のメールアプリが、件名・本文・リンクを入れた状態で開きます。
                      {isOwner ? (mates.length ? `宛先には同行者 ${mates.length}人のアドレスを入れます。` : '同行者のアドレスが無いため、宛先は空です。') : '宛先は自分で入れてください。'}
                    </p>
                    <p className="m-0 text-xs text-ink-700">メールアプリへ PDF を自動では付けられません。付ける時は「PDF を保存」してから、メールに添付してください。</p>
                    <div className="flex flex-wrap gap-2">
                      {mailHref ? (
                        <a className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" href={mailHref} data-testid="booklet-share-mailto">
                          <Mail size={15} aria-hidden="true" />メールアプリを開く
                        </a>
                      ) : <span className="text-sm">先に「送るリンク」を決めてください。</span>}
                      <Button size="sm" variant="outline" icon={<Download size={15} />} onClick={() => void savePdf()} loading={busy === 'pdf'}>PDF を保存</Button>
                    </div>
                  </div>
                )}

                {tab === 'device' && (
                  <div className="space-y-2">
                    {canShare ? (
                      <>
                        <p className="m-0 text-sm">スマホの共有の画面が開きます。LINE・メール・メッセージなど、使い慣れたアプリで送れます。</p>
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="primary" icon={<Share2 size={15} />} onClick={() => void shareLink()} disabled={!url} loading={busy === 'device'}>リンクを送る</Button>
                          {info.can_attach_pdf && (
                            <Button size="sm" variant="outline" icon={<Share2 size={15} />} onClick={() => void sharePdf()} loading={busy === 'devicepdf'}>PDF を送る</Button>
                          )}
                        </div>
                      </>
                    ) : (
                      <p className="m-0 text-sm" data-testid="booklet-share-noshare">この端末(ブラウザ)には共有の機能がありません。スマホで開くか、リンクをコピー・QR コード・メールアプリで送ってください。</p>
                    )}
                  </div>
                )}

                {tab === 'appmail' && (
                  <div className="space-y-3" data-testid="booklet-share-appmail">
                    {!info.email_available ? (
                      <p className="tc-bshare__msg" data-tone="warn" role="note">
                        この環境にはメールを送る設定がありません(管理者がメールサーバーを設定すると使えます)。
                        今は「メールアプリで送る」か「スマホで送る」を使ってください。
                      </p>
                    ) : (
                      <>
                        {info.email_sandbox && (
                          <p className="tc-bshare__msg" data-tone="warn" role="note" data-testid="booklet-share-sandbox">
                            この環境のメールは確認用の受信箱へ届き、外へは届きません。
                            受信箱: <a href={sandboxInboxUrl(window.location)} target="_blank" rel="noopener noreferrer">{sandboxInboxUrl(window.location)}</a>
                          </p>
                        )}
                        <fieldset className="tc-bshare__box">
                          <legend>送り先(旅行のメンバー)</legend>
                          {info.recipients.length === 0 ? <p className="m-0 text-sm">ほかのメンバーがいません。共有の画面で同行者を招待してください。</p> : (
                            <ul className="tc-bshare__people">
                              {info.recipients.map((r) => (
                                <li key={r.user_id}>
                                  <label>
                                    <input type="checkbox" disabled={!r.has_email} checked={picked.has(r.user_id)}
                                      onChange={(ev) => setPicked((s) => {
                                        const n = new Set(s);
                                        if (ev.target.checked) n.add(r.user_id); else n.delete(r.user_id);
                                        return n;
                                      })} />
                                    <span>{r.name}<small>{ROLE_LABEL[r.role] ?? r.role}{r.has_email ? '' : '・メールアドレスなし'}</small></span>
                                  </label>
                                </li>
                              ))}
                            </ul>
                          )}
                          <p className="m-0 mt-1 text-xs text-ink-700">相手のアドレスはこの画面には出しません。1 人ずつ別のメールで送ります。</p>
                        </fieldset>
                        <fieldset className="tc-bshare__box">
                          <legend>メールに入れるもの</legend>
                          <label className="tc-bshare__check">
                            <input type="checkbox" checked={attachPdf && info.can_attach_pdf} disabled={!info.can_attach_pdf} onChange={(e) => setAttachPdf(e.target.checked)} />
                            <span>PDF を添付{info.can_attach_pdf ? '' : '(機密項目を含む版は付けられません)'}</span>
                          </label>
                          <label className="tc-bshare__check">
                            <input type="checkbox" checked={webLink && !!info.public_path} disabled={!info.public_path} onChange={(e) => setWebLink(e.target.checked)} />
                            <span>公開ページのリンク{info.public_path ? '' : '(公開すると入れられます)'}</span>
                          </label>
                          <label className="tc-bshare__check">
                            <input type="checkbox" checked={appLink} onChange={(e) => setAppLink(e.target.checked)} />
                            <span>TravelCanvas で開くリンク(編集できる同行者用)</span>
                          </label>
                        </fieldset>
                        <div>
                          <label htmlFor="bshare-msg" className="block text-sm font-medium text-ink-900 mb-1">ひとこと(任意)</label>
                          <textarea id="bshare-msg" className="tc-bshare__text" rows={3} maxLength={1000} value={message}
                            onChange={(e) => setMessage(e.target.value)} placeholder="来週の旅行のしおりです。目を通しておいてください。" />
                        </div>
                        <Button variant="primary" icon={<Send size={16} />} onClick={() => void send()} loading={busy === 'send'}
                          disabled={picked.size === 0 || !(attachPdf && info.can_attach_pdf || webLink && info.public_path || appLink)}
                          data-testid="booklet-share-send">
                          {`${picked.size}人に送る`}
                        </Button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {notice && <p className="tc-bshare__msg" data-tone={notice.tone} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
            </>
          )}
        </div>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline" icon={<Download size={16} />} onClick={() => void savePdf()} loading={busy === 'pdf'} disabled={!info}>PDF を保存</Button>
        <Button variant="primary" onClick={onClose}>閉じる</Button>
      </Modal.Footer>
    </Modal>
  );
};

export default BookletShareDialog;
