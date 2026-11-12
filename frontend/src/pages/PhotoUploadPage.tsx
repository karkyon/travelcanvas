/**
 * [Gate PhotoQR] QR から開く写真の投稿ページ(/u/:token、提案 SC-52)。ログインしていなくても開けるが、投稿には認証が要る。
 * - 確認コード: QR を発行した本人の端末向け。この QR への投稿だけの権限を受け取る(ログインにはならない)
 * - ログイン: 同行者向け。旅行の編集者以上だけ投稿できる
 * 撮影位置と日時は端末で読んで送る。1 枚ずつ送り、失敗した写真だけ送り直せる。
 */
import React, { useEffect, useRef, useState } from 'react';
import PasteImageButton from '@/components/media/PasteImageButton';
import { Link, useParams } from 'react-router-dom';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { useAuthStore } from '@/store/authStore';
import {
  joinUploadLink, openUploadSession, uploadAsMember, uploadWithSession, viewUploadLink,
} from '@/services/api/photoFeatures';
import type { PublicUploadLink, UploadResult } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { fieldsFromInfo, newUploadId, readPhotoInfo } from './memories/photoRead';

type Auth = { kind: 'session'; token: string } | { kind: 'member'; planId: string };
interface Item { file: File; id: string; state: 'wait' | 'sending' | 'done' | 'failed'; message?: string; result?: UploadResult }

const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif';

const PhotoUploadPage: React.FC = () => {
  const { token = '' } = useParams<{ token: string }>();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [info, setInfo] = useState<PublicUploadLink | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [auth, setAuth] = useState<Auth | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [visibility, setVisibility] = useState('private');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    const referrer = document.createElement('meta');
    referrer.name = 'referrer';
    referrer.content = 'no-referrer';
    document.head.appendChild(referrer);
    return () => { meta.remove(); referrer.remove(); };
  }, []);
  useEffect(() => {
    viewUploadLink(token).then(setInfo).catch((e) => setPageError(errorDetailMessage(e, 'この QR コードは使えません')));
  }, [token]);

  const submitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const s = await openUploadSession(token, code);
      setAuth({ kind: 'session', token: s.session_token });
    } catch (err) {
      setError(errorDetailMessage(err, '確認コードを確かめられませんでした'));
    }
  };
  const continueAsMember = async () => {
    setError(null);
    try {
      const j = await joinUploadLink(token);
      setAuth({ kind: 'member', planId: j.plan_id });
    } catch (err) {
      setError(errorDetailMessage(err, 'この旅行に写真を送る権限がありません'));
    }
  };

  const update = (id: string, patch: Partial<Item>) => setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));
  const sendAll = async (targets: Item[]) => {
    if (!auth) return;
    setSending(true);
    for (const item of targets) {
      update(item.id, { state: 'sending', message: undefined });
      try {
        const fields = { ...fieldsFromInfo(await readPhotoInfo(item.file)), visibility, client_upload_id: item.id };
        const result = auth.kind === 'session'
          ? await uploadWithSession(token, auth.token, item.file, fields)
          : await uploadAsMember(auth.planId, item.file, fields);
        update(item.id, { state: 'done', result });
      } catch (err) {
        update(item.id, { state: 'failed', message: errorDetailMessage(err, '送れませんでした') });
      }
    }
    setSending(false);
  };
  const choose = (e: React.ChangeEvent<HTMLInputElement>) => {
    const added = Array.from(e.target.files ?? []).map((file) => ({ file, id: newUploadId(), state: 'wait' as const }));
    setItems((prev) => [...prev.filter((i) => i.state !== 'done'), ...added]);
    e.target.value = '';
    void sendAll(added);
  };
  // [Gate PhotoPasteAll] クリップボードの画像も同じく送る
  const pasted = (file: File) => {
    const added = [{ file, id: newUploadId(), state: 'wait' as const }];
    setItems((prev) => [...prev.filter((i) => i.state !== 'done'), ...added]);
    void sendAll(added);
  };

  const done = items.filter((i) => i.state === 'done');
  const failed = items.filter((i) => i.state === 'failed');
  const count = (f: (i: Item) => boolean) => done.filter(f).length;
  return (
    <main className="min-h-screen bg-cloud-50 px-4 py-6" data-testid="photo-upload-page">
      <div className="mx-auto max-w-md space-y-4">
        <p className="text-xs text-ink-700">TravelCanvas ・ 写真の投稿</p>
        {!info && !pageError && <div className="flex justify-center py-16" role="status"><LoadingSpinner size="lg" /></div>}
        {pageError && <p role="alert" className="tc-card p-5 text-sm">{pageError}</p>}
        {info && !info.active && <p role="alert" className="tc-card p-5 text-sm">この QR コードは期限が切れたか、停止されています。新しい QR を発行してもらってください。</p>}
        {info && info.active && (
          <>
            <h1 className="text-xl font-bold text-ink-900">{`「${info.plan_title}」に写真を追加`}</h1>
            {error && <p role="alert" className="text-sm text-danger">{error}</p>}
            {!auth && (
              <div className="space-y-4">
                <form onSubmit={(e) => void submitCode(e)} className="tc-card p-4 space-y-2">
                  <label htmlFor="upload-code" className="block font-semibold text-sm">PC に出ている確認コード</label>
                  <input id="upload-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} className="block w-full border rounded-sm px-3 py-2 text-lg tracking-widest"
                    value={code} onChange={(e) => setCode(e.target.value)} />
                  <button type="submit" className="tc-focus-ring tc-mbtn tc-mbtn--primary w-full" disabled={code.replace(/\D/g, '').length !== 6}>続ける</button>
                  <p className="text-xs text-ink-700">QR を出した本人向けです。この旅行への投稿だけを最長 12 時間許可します。</p>
                </form>
                <div className="tc-card p-4 space-y-2">
                  <p className="font-semibold text-sm">同行者の方</p>
                  {isAuthenticated
                    ? <button type="button" className="tc-focus-ring tc-mbtn w-full" onClick={() => void continueAsMember()}>ログイン中のアカウントで続ける</button>
                    : <Link className="tc-focus-ring tc-mbtn w-full text-center block" to={`/login?next=${encodeURIComponent(`/u/${token}`)}`}>TC アカウントでログイン</Link>}
                </div>
              </div>
            )}
            {auth && (
              <div className="space-y-3">
                <div className="tc-card p-4 space-y-2">
                  <input ref={input} type="file" multiple accept={PHOTO_ACCEPT} className="sr-only" id="upload-files" onChange={choose} data-testid="upload-files" />
                  <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary w-full" disabled={sending} onClick={() => input.current?.click()}>写真を選んで送る</button>
                  <PasteImageButton onImage={pasted} disabled={sending} testId="upload-paste" />
                  <label className="block text-sm">公開範囲
                    <select className="block w-full mt-1 border rounded-sm px-2 py-1" value={visibility} onChange={(e) => setVisibility(e.target.value)}>
                      <option value="private">自分だけ</option>
                      <option value="members">旅行のメンバー(位置は自分だけ)</option>
                    </select>
                  </label>
                  <p className="text-xs text-ink-700">iPhone は写真を選ぶ画面の「オプション」で「位置情報を含める」を ON にすると、撮影位置を使えます。位置が無い写真は、撮影時刻から場所を推定して確認をお願いします。</p>
                </div>
                {items.length > 0 && (
                  <ul className="tc-card p-4 space-y-1 text-sm" aria-live="polite" aria-label="送信の状況">
                    {items.map((i) => (
                      <li key={i.id} className="flex items-center justify-between gap-2">
                        <span className="truncate min-w-0">{i.file.name}</span>
                        <span className="shrink-0">{i.state === 'done' ? '完了' : i.state === 'failed' ? (i.message ?? '失敗') : i.state === 'sending' ? '送信中' : '待機'}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {failed.length > 0 && !sending && <button type="button" className="tc-focus-ring tc-mbtn w-full" onClick={() => void sendAll(failed)}>{`失敗した ${failed.length} 枚を送り直す`}</button>}
                {done.length > 0 && !sending && (
                  <p role="status" className="tc-card p-4 text-sm" data-testid="upload-summary">
                    {`${done.length} 枚を送りました。撮影位置で配置 ${count((i) => i.result?.location_status === 'confirmed')} 枚、推定(確認待ち) ${count((i) => i.result?.location_status === 'proposed')} 枚、未配置 ${count((i) => !i.result?.location_status)} 枚です。確認は旅の記録の「写真の地図」でできます。`}
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
};

export default PhotoUploadPage;
