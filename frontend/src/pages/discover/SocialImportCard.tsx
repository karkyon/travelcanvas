/**
 * [Gate G11] SNS の投稿から候補を作る(docs/ux/G11_UIUX全範囲_実装仕様.md §3.3・UIX-M09。画面の正本のモックの「SNS から取り込む」)。
 *
 * 流れ: URL を貼る → 確かめる(公式の oEmbed で題名・作者だけ。保存しない)→ 確認のカード(SNS・作者・題名・取得時刻・
 * 場所の候補と確からしさ「低」「中」)→ 利用者が名前・場所を直す → 候補箱へ追加。
 * 取れない(対応外・ログインが要る・消えた・止めてある)時は「URL とメモを出典として保存」に切り替え、取れたように見せない。
 * 題名・作者は表示するだけ(信用しないデータ。HTML として描かない)。画像は取り込まない・表示しない(権利が不明)。
 */
import React, { useId, useState } from 'react';
import Button from '@/components/common/Button';
import { previewSocialUrl } from '@/services/api/g11discover';
import type { SocialPreview } from '@/services/api/types/g11discover';

const PLATFORM_LABEL: Record<string, string> = { youtube: 'YouTube', tiktok: 'TikTok', instagram: 'Instagram' };
const REASON: Record<string, string> = {
  unsupported_platform: '対応していない SNS の URL です(YouTube・TikTok・Instagram に対応)',
  provider_disabled: 'この SNS の確認は止めてあります',
  token_required: 'この SNS は、運用の設定(鍵)が無いため内容を確かめられません',
  not_found: '投稿が見つかりません(消えたか、非公開です)',
  forbidden: '投稿を確かめられません(ログインが要るか、非公開です)',
  rate_limited: '確認の回数の上限に達しました。時間をおいてください',
};

export interface SocialCandidateInput {
  title: string;
  source_url: string;
  note: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  platform: 'youtube' | 'tiktok' | 'instagram' | null;
  retrieved_at: string | null;
  social: boolean;
}

interface Props {
  planId: string;
  canEdit: boolean;
  onSave: (input: SocialCandidateInput) => Promise<void>;
}

const SocialImportCard: React.FC<Props> = ({ planId, canEdit, onSave }) => {
  const uid = useId();
  const [url, setUrl] = useState('');
  const [preview, setPreview] = useState<SocialPreview | null>(null);
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [pick, setPick] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const check = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const p = await previewSocialUrl(planId, url.trim());
      setPreview(p);
      setTitle(p.place_suggestions[0]?.name ?? p.title ?? '');
      setPick(p.place_suggestions.length ? 0 : null);
    } catch (err) {
      const detail = (err as { response?: { data?: { detail?: { message?: string } } } })?.response?.data?.detail;
      setPreview(null);
      setError(detail?.message ?? 'URL を確かめられませんでした');
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    if (!preview?.url) return;
    setBusy(true);
    setError(null);
    try {
      const place = pick !== null ? preview.place_suggestions[pick] : undefined;
      const ok = preview.status === 'ok';
      await onSave({
        title: title.trim() || (ok ? preview.title ?? '' : ''),
        source_url: preview.url,
        note: note.trim() || null,
        address: place?.address ?? null,
        latitude: place?.latitude ?? null,
        longitude: place?.longitude ?? null,
        platform: preview.platform,
        retrieved_at: ok ? preview.retrieved_at : null,
        social: ok && preview.platform !== null,
      });
      setSaved(true);
    } catch {
      setError('候補箱に入れられませんでした');
    } finally {
      setBusy(false);
    }
  };

  const ok = preview?.status === 'ok';
  return (
    <section aria-labelledby={`${uid}-t`} className="rounded-xl border border-cloud-200 bg-surface p-4" data-testid="social-import">
      <h2 id={`${uid}-t`} className="font-semibold text-ink-900">SNS の投稿から取り込む</h2>
      <p className="text-xs text-ink-700">
        投稿の URL から、題名・作者を公式の方法(oEmbed)で確かめ、場所の候補を出します。内容を確かめてから候補箱へ入れます。画像は取り込みません。
      </p>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={check} aria-label="SNS の投稿の URL を確かめる">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${uid}-u`} className="block text-sm text-ink-700">投稿の URL</label>
          <input id={`${uid}-u`} value={url} onChange={(e) => setUrl(e.target.value)} type="url" required
            placeholder="https://www.youtube.com/watch?v=…" data-testid="social-url"
            className="mt-1 w-full rounded-md border border-cloud-200 bg-surface px-3 py-2 text-ink-900" />
        </div>
        <Button type="submit" loading={busy && !preview} disabled={busy || !canEdit} data-testid="social-check">URL を確かめる</Button>
      </form>
      {error && <p role="alert" className="mt-3 rounded-md bg-danger-soft p-3 text-sm text-danger">{error}</p>}
      {preview && (
        <div className="mt-3 rounded-lg border border-cloud-200 p-3 text-sm" data-testid="social-preview" data-status={preview.status}>
          {ok ? (
            <>
              <p className="text-xs text-ink-700">
                {`${PLATFORM_LABEL[preview.platform ?? ''] ?? 'SNS'} · 作者 ${preview.author ?? '不明'} · 取得 ${(preview.retrieved_at ?? '').slice(0, 16).replace('T', ' ')}`}
              </p>
              <p className="mt-1 font-semibold text-ink-900 break-words" data-testid="social-title">{preview.title ?? '(題名なし)'}</p>
              {preview.place_suggestions.length > 0 ? (
                <fieldset className="mt-2">
                  <legend className="text-xs text-ink-700">場所の候補(題名から推定。確かめてください)</legend>
                  {preview.place_suggestions.map((s, i) => (
                    <label key={`${s.word}-${i}`} className="mt-1 flex items-start gap-2">
                      <input type="radio" name={`${uid}-place`} checked={pick === i} onChange={() => { setPick(i); setTitle(s.name); }} />
                      <span>
                        <span className="text-ink-900">{s.name}</span>
                        <span className="text-xs text-ink-700">{` · 確からしさ ${s.confidence === 'medium' ? '中' : '低'}${s.address ? ` · ${s.address}` : ''}`}</span>
                      </span>
                    </label>
                  ))}
                  <label className="mt-1 flex items-center gap-2">
                    <input type="radio" name={`${uid}-place`} checked={pick === null} onChange={() => setPick(null)} />
                    <span className="text-ink-700">場所は後で決める</span>
                  </label>
                </fieldset>
              ) : (
                <p className="mt-2 text-xs text-ink-700">題名から場所を推定できませんでした。名前を入れて候補箱へ入れられます。</p>
              )}
            </>
          ) : (
            <p className="text-sm text-warning" data-testid="social-fallback">
              {`${REASON[preview.reason ?? ''] ?? '投稿の内容を確かめられませんでした'}。URL とメモを出典として候補箱へ保存できます(内容は取り込みません)。`}
            </p>
          )}
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-sm text-ink-700">候補の名前
              <input value={title} onChange={(e) => setTitle(e.target.value)} data-testid="social-name"
                className="mt-1 w-full rounded-md border border-cloud-200 bg-surface px-3 py-2 text-ink-900" />
            </label>
            <label className="text-sm text-ink-700">メモ(任意)
              <input value={note} onChange={(e) => setNote(e.target.value)}
                className="mt-1 w-full rounded-md border border-cloud-200 bg-surface px-3 py-2 text-ink-900" />
            </label>
          </div>
          <Button type="button" className="mt-3" onClick={save} loading={busy} disabled={busy || !canEdit || saved}
            data-testid="social-save">
            {saved ? '候補箱に入れました' : ok ? '候補箱へ追加' : 'URL とメモを出典として保存'}
          </Button>
        </div>
      )}
    </section>
  );
};

export default SocialImportCard;
