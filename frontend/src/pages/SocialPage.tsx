/**
 * [FR-063] SNS の下書きとリール(/planner/:planId/social。詳細設計 DD-2026-11-22-01 §8.2)。
 *
 * 段: 1 選ぶ → 2 文 → 3 リール(文だけの出す先は 3 を飛ばす)。
 * - 選ぶ: 範囲(旅行全体 / 日ごと / エリア)・出す先 6 つ・写真(自分の写真と、メンバーに見せる写真だけ。撮った順。上へ/下へ)・
 *   ルートの地図のコマ・顔をぼかす(Vision の鍵がある時だけ)
 * - 文: ひな形(AI を使わない)をそのまま直せる。字数の目安・ハッシュタグの札・「AI で整える」(押した時だけ)・文をコピー・共有
 * - リール: 9:16 の見本・長さ 15/30/60 秒・見せ方の型・表紙・安全な範囲の枠・音(無音 / 自分の声)・端末で作る・保存・共有
 * アプリは投稿しない。音楽は付けない。動画は端末だけに置く(画面を離れたら消す)。
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowDown, ArrowLeft, ArrowUp, Copy, Download, Film, Share2, Sparkles, X } from 'lucide-react';
import {
  getFaceBoxes, getMemoryBlob, getSocialDraft, polishSocialText, recordReelExport, type SocialDraft, type SocialScope,
} from '@/services/api/social';
import { getMemoryThumbnail } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  DURATIONS, MUSIC_NOTE, REEL_H, REEL_W, STYLES, TEMPLATES, WEBM_NOTE, charInfo, hasTag, isReel, move, photoRange, plannedSeconds,
  safeRect, toggleTag, type Style, type Template,
} from './social/socialModel';
import { RenderCancelled, drawAt, loadFrameImage, renderReel, wakeLockAvailable, type ReelInput, type ReelResult } from './social/reelRender';

const CREDIT_KEY = 'tc_reel_credit';
const readCredit = () => { try { return localStorage.getItem(CREDIT_KEY) !== '0'; } catch { return true; } };

const Thumb: React.FC<{ planId: string; id: string; alt: string }> = ({ planId, id, alt }) => {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let u: string | null = null;
    let alive = true;
    getMemoryThumbnail(planId, id).then((b) => { if (alive) { u = URL.createObjectURL(b); setUrl(u); } }).catch(() => undefined);
    return () => { alive = false; if (u) URL.revokeObjectURL(u); };
  }, [planId, id]);
  return url ? <img src={url} alt={alt} className="h-20 w-20 rounded-lg object-cover" /> : <span className="block h-20 w-20 rounded-lg bg-cloud-100" aria-hidden="true" />;
};

const SocialPage: React.FC = () => {
  const { planId = '' } = useParams<{ planId: string }>();
  const [params] = useSearchParams();
  const [step, setStep] = useState<1 | 2 | 3>(params.get('step') === '3' ? 3 : 1);
  const [scope, setScope] = useState<SocialScope>('trip');
  const [scopeRef, setScopeRef] = useState<string>('');
  const [style, setStyle] = useState<Style>('tiktok');
  const [includeTime, setIncludeTime] = useState(false);
  const [draft, setDraft] = useState<SocialDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>([]);
  const [withMap, setWithMap] = useState(true);
  const [blurFaces, setBlurFaces] = useState(false);
  const [text, setText] = useState('');
  const [polishing, setPolishing] = useState(false);
  const [duration, setDuration] = useState<number>(30);
  const [template, setTemplate] = useState<Template>('flow');
  const [showSafe, setShowSafe] = useState(false);
  const [audioId, setAudioId] = useState<string>('');
  const [credit, setCredit] = useState(readCredit);
  const [progress, setProgress] = useState<number | null>(null);
  const [result, setResult] = useState<(ReelResult & { url: string }) | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const previewRef = useRef<HTMLCanvasElement | null>(null);
  const [preview, setPreview] = useState<ReelInput | null>(null);
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    try {
      const d = await getSocialDraft(planId, { scope, style, include_time: includeTime, scope_ref: scope === 'trip' ? null : scopeRef || null });
      setDraft(d);
      setText([d.text, d.hashtags.join(' ')].filter(Boolean).join('\n'));
      const [, max] = d.photo_range;
      setChosen((cur) => (cur.length ? cur.filter((id) => d.photos.some((p) => p.memory_id === id)) : d.photos.slice(0, max).map((p) => p.memory_id)));
      setError(null);
    } catch (e) {
      setError(errorDetailMessage(e, '下書きを作れませんでした'));
    }
  }, [planId, scope, style, includeTime, scopeRef]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => { if (result) URL.revokeObjectURL(result.url); }, [result]);
  useEffect(() => { try { localStorage.setItem(CREDIT_KEY, credit ? '1' : '0'); } catch { /* 覚えられなくても動く */ } }, [credit]);

  const [minP, maxP] = photoRange(style);
  const reel = isReel(style);
  const info = charInfo(text, style);
  const photosById = useMemo(() => new Map((draft?.photos ?? []).map((p) => [p.memory_id, p])), [draft]);
  const steps: [1 | 2 | 3, string][] = reel ? [[1, '1 選ぶ'], [2, '2 文'], [3, '3 リール']] : [[1, '1 選ぶ'], [2, '2 文']];

  const togglePhoto = (id: string) => setChosen((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= maxP ? cur : [...cur, id]));

  const buildInput = async (): Promise<ReelInput> => {
    const ids = chosen.slice(0, maxP);
    let faces: Record<string, number[][]> = {};
    if (blurFaces) {
      const got = await getFaceBoxes(planId, ids).catch(() => ({ configured: false, boxes: {} as Record<string, number[][]> }));
      if (!got.configured) setMsg('顔の検査の鍵が未登録のため、ぼかさずに作ります(写っている人の了解を確かめてください)');
      faces = got.boxes;
    }
    const frames = await Promise.all(ids.map(async (id) => {
      const p = photosById.get(id);
      return { image: await loadFrameImage(await getMemoryBlob(planId, id)), label: p?.place_name ?? null, date: p?.taken_at ?? null,
        faces: faces[id] };
    }));
    const audio = audioId ? await getMemoryBlob(planId, audioId) : null;
    const period = draft?.period ? `${draft.period.start}${draft.period.end !== draft.period.start ? `〜${draft.period.end}` : ''}` : null;
    return { frames, title: draft?.title ?? '', period, routeShape: draft?.route_shape ?? [], durationS: duration, template, withMap,
      credit, audio };
  };

  const playPreview = async () => {
    try {
      const input = preview ?? await buildInput();
      setPreview(input);
      setPlaying(true);
    } catch (e) {
      setError(errorDetailMessage(e, '見本を作れませんでした'));
    }
  };
  useEffect(() => {
    if (!playing || !preview || !previewRef.current) return undefined;
    const ctx = previewRef.current.getContext('2d');
    if (!ctx) return undefined;
    const start = performance.now();
    let raf = 0;
    const total = plannedSeconds(preview.durationS, preview.frames.length, preview.withMap);
    const tick = () => {
      const t = (performance.now() - start) / 1000;
      if (t > total) { setPlaying(false); return; }
      drawAt(ctx, preview, t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, preview]);

  const make = async () => {
    if (chosen.length < minP) { setError(`写真を ${minP} 枚以上選んでください`); return; }
    setError(null); setMsg(null); setResult(null);
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setProgress(0);
    // タブを裏に回すと時計が間引かれ、動画の長さ・切り替えが崩れる。裏に回った時は止めて知らせる
    let hidden = false;
    const onHide = () => { if (document.visibilityState === 'hidden') { hidden = true; ctrl.abort(); } };
    document.addEventListener('visibilitychange', onHide);
    let input: ReelInput | null = null;
    try {
      input = await buildInput();
      const r = await renderReel(input, { signal: ctrl.signal, onProgress: setProgress });
      setResult({ ...r, url: URL.createObjectURL(r.blob) });
      void recordReelExport(planId, { style, scope, duration_s: Math.round(r.seconds), frame_count: input.frames.length, status: 'ready',
        bytes: r.blob.size }).catch(() => undefined);
    } catch (e) {
      if (e instanceof RenderCancelled) {
        setMsg(hidden ? '画面を離れたため、動画を作るのを止めました。画面を開いたまま、もう一度「動画を作る」を押してください'
          : '動画を作るのをやめました');
      }
      else {
        setError(errorDetailMessage(e, '動画を作れませんでした'));
        void recordReelExport(planId, { style, scope, duration_s: duration, frame_count: chosen.length, status: 'failed' }).catch(() => undefined);
      }
    } finally {
      document.removeEventListener('visibilitychange', onHide);
      // 写真の絵(ImageBitmap)は作り終えたら返す(端末のメモリを使い続けない)
      for (const f of input?.frames ?? []) (f.image as ImageBitmap).close?.();
      setProgress(null);
      abortRef.current = null;
    }
  };
  // 画面を離れたら作るのをやめる(裏で録り続けない)
  useEffect(() => () => abortRef.current?.abort(), []);

  const fileName = (ext: string) => `${(draft?.title || 'travelcanvas').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40)}_${style}.${ext}`;
  const canShareFile = (f: File) => {
    try { return typeof navigator.canShare === 'function' && navigator.canShare({ files: [f] }); } catch { return false; }
  };
  const shareVideo = async () => {
    if (!result) return;
    const file = new File([result.blob], fileName(result.ext), { type: result.blob.type });
    try {
      await navigator.share?.({ files: [file], text });
    } catch { /* 閉じた時は何もしない */ }
  };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(text); setMsg('文をコピーしました'); } catch { setError('コピーできませんでした。文を選んでコピーしてください'); }
  };
  const shareText = async () => {
    if (typeof navigator.share !== 'function') { await copyText(); return; }
    try { await navigator.share({ text }); } catch { /* 閉じた */ }
  };
  const polish = async () => {
    setPolishing(true);
    try { setText(await polishSocialText(planId, text, style)); setMsg('AI で整えました。内容を確かめてください'); } catch (e) {
      setError(errorDetailMessage(e, 'AI で整えられませんでした。下書きのまま使えます'));
    } finally { setPolishing(false); }
  };

  const safe = safeRect(270, 480);
  const resultFile = result ? new File([result.blob], fileName(result.ext), { type: result.blob.type }) : null;

  return (
    <div className="tc-page tc-page--md" data-testid="social">
      <Link to={`/planner/${planId}/journey`} className="tc-focus-ring tc-mbtn mb-2 min-h-11"><ArrowLeft size={16} aria-hidden="true" />旅の記録へ戻る</Link>
      <h1 className="tc-page-title" data-eyebrow="SOCIAL · SNS">SNS の下書きとリール</h1>
      <p className="text-sm text-ink-700">アプリから投稿はしません。文をコピーし、動画は端末に保存して、各アプリで投稿してください。</p>
      <ol className="tc-list-tabs mt-3" aria-label="段">
        {steps.map(([n, l]) => (
          <li key={n}><button type="button" aria-current={step === n ? 'step' : undefined} className={`tc-focus-ring tc-pill min-h-11 ${step === n ? 'is-active font-semibold' : ''}`}
            onClick={() => setStep(n)}>{l}</button></li>
        ))}
      </ol>
      {error && <p role="alert" className="mt-3 text-sm text-red-800">{error}</p>}
      {msg && <p role="status" className="mt-3 text-sm text-ink-900">{msg}</p>}

      {step === 1 && (
        <section className="mt-4 space-y-4" aria-label="選ぶ">
          <fieldset><legend className="font-semibold">範囲</legend>
            <div className="mt-1 flex gap-2">{([['trip', '旅行全体'], ['day', '日ごと'], ['area', 'エリア']] as [SocialScope, string][]).map(([v, l]) => (
              <button key={v} type="button" aria-pressed={scope === v} className="tc-focus-ring tc-pill min-h-11"
                onClick={() => { setScope(v); setScopeRef(''); }}>{l}</button>))}</div>
            {scope !== 'trip' && (
              <select aria-label={scope === 'day' ? 'どの日' : 'どのエリア'} data-testid="social-scope-ref" value={scopeRef}
                className="tc-focus-ring mt-2 min-h-11 rounded-xl border px-2" onChange={(e) => setScopeRef(e.target.value)}>
                <option value="">{scope === 'day' ? 'すべての日' : 'すべてのエリア'}</option>
                {((scope === 'day' ? draft?.choices?.days : draft?.choices?.areas) ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            )}
          </fieldset>
          <fieldset><legend className="font-semibold">出す先</legend>
            <div className="mt-1 flex flex-wrap gap-2">{STYLES.map(([v, l]) => (
              <button key={v} type="button" aria-pressed={style === v} data-testid={`social-style-${v}`} className="tc-focus-ring tc-pill min-h-11"
                onClick={() => setStyle(v)}>{l}</button>))}</div>
            <p className="mt-1 text-xs text-ink-700">{reel ? '縦の動画と文を作ります' : '文と写真を作ります'}</p>
          </fieldset>
          <fieldset>
            <legend className="font-semibold">{`写真(${chosen.length} / ${minP}〜${maxP} 枚)`}</legend>
            {draft && draft.photos.length === 0 && <p className="text-sm text-ink-700">使える写真がありません(自分の写真と、メンバーに見せる写真だけを使います)</p>}
            <ul className="mt-2 grid grid-cols-3 gap-2 sm:grid-cols-5" aria-label="写真を選ぶ">
              {(draft?.photos ?? []).map((p) => {
                const on = chosen.includes(p.memory_id);
                return (
                  <li key={p.memory_id}>
                    <button type="button" aria-pressed={on} className={`tc-focus-ring rounded-lg ${on ? 'ring-4 ring-ink-900' : 'opacity-70'}`}
                      onClick={() => togglePhoto(p.memory_id)} aria-label={`${p.place_name ?? '写真'}${p.taken_at ? ` ${p.taken_at}` : ''}${on ? '(選んでいる)' : ''}`}>
                      <Thumb planId={planId} id={p.memory_id} alt="" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {chosen.length > 0 && (
              <ol className="mt-2 space-y-1" aria-label="並び(撮った順。上へ・下へで動かす)">
                {chosen.map((id, i) => (
                  <li key={id} className="flex items-center gap-2 text-sm">
                    <span>{`${i + 1}. ${photosById.get(id)?.place_name ?? '写真'}${i === 0 ? '(表紙)' : ''}`}</span>
                    <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm min-h-11" aria-label="上へ" onClick={() => setChosen((c) => move(c, i, -1))}><ArrowUp size={14} /></button>
                    <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm min-h-11" aria-label="下へ" onClick={() => setChosen((c) => move(c, i, 1))}><ArrowDown size={14} /></button>
                  </li>
                ))}
              </ol>
            )}
          </fieldset>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={withMap} onChange={(e) => setWithMap(e.target.checked)} />ルートの地図のコマ(形だけの地図)</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={blurFaces} onChange={(e) => setBlurFaces(e.target.checked)} />
            顔をぼかす(顔の検査の鍵がある時だけ。自分の写真を縮めて検査し、ぼかすのは端末の中)</label>
          <label className="flex min-h-11 items-center gap-2"><input type="checkbox" checked={includeTime} onChange={(e) => setIncludeTime(e.target.checked)} />時刻を入れる(既定は日付だけ)</label>
          {draft && (draft.excluded.home_near > 0 || draft.excluded.names > 0) && (
            <p className="text-xs text-ink-700" data-testid="social-excluded">{`外しました: 自宅の近く ${draft.excluded.home_near} 件・人の名前 ${draft.excluded.names} 件`}</p>
          )}
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11" onClick={() => setStep(2)}>次へ(文)</button>
        </section>
      )}

      {step === 2 && (
        <section className="mt-4 space-y-3" aria-label="文">
          <label htmlFor="social-text" className="font-semibold">投稿の文(そのまま直せます)</label>
          <textarea id="social-text" rows={8} value={text} onChange={(e) => setText(e.target.value)}
            className="tc-focus-ring w-full rounded-xl border border-cloud-200 bg-cloud-0 p-3 text-ink-900" />
          <p className={`text-xs ${info.over ? 'text-red-800' : 'text-ink-700'}`} data-testid="social-count">
            {`${info.count} / ${info.limit.toLocaleString('ja-JP')} 字${info.note ? `(${info.note})` : ''}${info.over ? ' — 多すぎます' : ''}`}</p>
          <div className="flex flex-wrap gap-2" aria-label="ハッシュタグ">
            {(draft?.hashtags ?? []).map((t) => (
              <button key={t} type="button" aria-pressed={hasTag(text, t)} className="tc-focus-ring tc-pill min-h-11" onClick={() => setText((x) => toggleTag(x, t))}>{t}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="tc-focus-ring tc-mbtn min-h-11" disabled={polishing} onClick={() => void polish()}>
              <Sparkles size={14} aria-hidden="true" />{polishing ? '整えています…' : 'AI で整える'}</button>
            <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => void copyText()}><Copy size={14} aria-hidden="true" />文をコピー</button>
            <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => void shareText()}><Share2 size={14} aria-hidden="true" />共有</button>
          </div>
          <p className="text-xs text-ink-700">「AI で整える」は押した時だけ。送るのは文だけで、写真は送りません(旅行相談と同じ利用枠)。</p>
          {reel && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11" onClick={() => setStep(3)}>次へ(リール)</button>}
        </section>
      )}

      {step === 3 && reel && (
        <section className="mt-4 space-y-3" aria-label="リール">
          <div className="relative mx-auto" style={{ width: 270, height: 480 }}>
            <canvas ref={previewRef} width={REEL_W} height={REEL_H} className="h-full w-full rounded-xl bg-ink-900" aria-label="リールの見本(縦 9:16)" />
            {showSafe && <span aria-hidden="true" data-testid="safe-frame" className="pointer-events-none absolute border-2 border-dashed border-white"
              style={{ left: safe.x, top: safe.y, width: safe.w, height: safe.h }} />}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => (playing ? setPlaying(false) : void playPreview())}>{playing ? '止める' : '見本を再生'}</button>
            <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={showSafe} onChange={(e) => setShowSafe(e.target.checked)} />安全な範囲の枠を出す</label>
          </div>
          <fieldset><legend className="font-semibold">長さ</legend>
            <div className="mt-1 flex gap-2">{DURATIONS.map((d) => (
              <button key={d} type="button" aria-pressed={duration === d} className="tc-focus-ring tc-pill min-h-11" onClick={() => { setDuration(d); setPreview(null); }}>{`${d} 秒`}</button>))}</div>
            <p className="text-xs text-ink-700">{`1 コマ ${Math.round((Math.min(4, Math.max(1.5, duration / Math.max(1, chosen.length)))) * 10) / 10} 秒・全体 約 ${plannedSeconds(duration, Math.max(1, chosen.length), withMap)} 秒`}</p>
          </fieldset>
          <fieldset><legend className="font-semibold">見せ方</legend>
            <div className="mt-1 flex flex-wrap gap-2">{TEMPLATES.map(([v, l]) => (
              <button key={v} type="button" aria-pressed={template === v} className="tc-focus-ring tc-pill min-h-11" onClick={() => { setTemplate(v); setPreview(null); }}>{l}</button>))}</div>
          </fieldset>
          <fieldset><legend className="font-semibold">音</legend>
            <select aria-label="音" className="tc-focus-ring min-h-11 rounded-xl border px-2" value={audioId} onChange={(e) => { setAudioId(e.target.value); setPreview(null); }}>
              <option value="">無音</option>
              {(draft?.audios ?? []).map((a, i) => <option key={a.memory_id} value={a.memory_id}>{`自分の声の記録 ${i + 1}${a.taken_at ? `(${a.taken_at})` : ''}`}</option>)}
            </select>
            <p className="text-xs text-ink-700">{MUSIC_NOTE}</p>
          </fieldset>
          <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={credit} onChange={(e) => setCredit(e.target.checked)} />最後に「TravelCanvas で作りました」を入れる</label>
          {progress === null ? (
            <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11" data-testid="reel-make" onClick={() => void make()}>
              <Film size={16} aria-hidden="true" />動画を作る</button>
          ) : (
            <div role="status" className="space-y-2">
              <progress max={1} value={progress} aria-label="動画を作る進み具合" className="w-full" />
              {!wakeLockAvailable() && <p className="text-xs">画面を消さないでください</p>}
              <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => abortRef.current?.abort()}><X size={14} aria-hidden="true" />やめる</button>
            </div>
          )}
          {result && resultFile && (
            <div className="tc-card space-y-2 p-3" data-testid="reel-result">
              <video src={result.url} controls playsInline className="mx-auto max-h-96 rounded-lg" aria-label="できた動画" />
              {!result.mp4 && <p className="text-sm text-ink-900">{WEBM_NOTE}</p>}
              <div className="flex flex-wrap gap-2">
                <a href={result.url} download={resultFile.name} className="tc-focus-ring tc-mbtn tc-mbtn--primary min-h-11"><Download size={14} aria-hidden="true" />保存</a>
                {canShareFile(resultFile) && <button type="button" className="tc-focus-ring tc-mbtn min-h-11" onClick={() => void shareVideo()}><Share2 size={14} aria-hidden="true" />共有</button>}
              </div>
              <p className="text-xs text-ink-700">「共有」で TikTok のアプリを選ぶと、投稿の画面へ進みます(アプリが投稿する訳ではありません)。</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
};

export default SocialPage;
