/**
 * [Gate GoogleSavedImport] Google マップの「行ってみたい」などの保存リストを「行きたい場所」へ取り込む窓。
 *
 * 1. Google データ エクスポート(Takeout)で「保存済み」(と「マップ(マイプレイス)」)を書き出す手順を出す
 * 2. 書き出したファイル(.zip・.csv・.json)を選ぶ。この端末の中で読む(ファイルはサーバーへ送らない)
 * 3. 取り込む場所を確かめる(既に「行きたい場所」にある場所は外しておく)。種類はまとめて選べる
 * 4. 1 件ずつ保存する。位置の無い場所は、保存の後に名前で住所・位置を探せる(OpenStreetMap。最大 30 件)
 * Google のアカウントにはつながない(リストを読む公開の API は無い。自動の同期は別に設計する)。
 */
import React, { useMemo, useRef, useState } from 'react';
import { ExternalLink, FileUp, MapPin, MapPinOff } from 'lucide-react';
import Modal from '@/components/common/Modal';
import { createWishSpot, enrichWishSpot, type WishSpot } from '@/services/api/spotIntake';
import { safeExternalUrl } from '@/utils/safeNavigation';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { markDuplicates, readImportFiles, type ImportRow } from './googleSavedImport';

const CATEGORIES: [string, string][] = [
  ['sightseeing', '観光地'], ['restaurant', 'レストラン'], ['accommodation', '宿泊'], ['shopping', 'ショッピング'], ['other', 'その他'],
];
const ENRICH_MAX = 30;
const TAKEOUT = 'https://takeout.google.com/';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  spots: WishSpot[];
  /** 取り込みが終わった(一覧を読み直す) */
  onDone: (message: string) => void;
}

type Phase = 'choose' | 'review' | 'saving' | 'done';

const GoogleSavedImportDialog: React.FC<Props> = ({ isOpen, onClose, spots, onDone }) => {
  const [phase, setPhase] = useState<Phase>('choose');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [category, setCategory] = useState('sightseeing');
  const [enrich, setEnrich] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0, enriched: 0 });
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const reset = () => {
    setPhase('choose'); setRows([]); setPicked(new Set()); setNote(null); setError(null);
    setProgress({ done: 0, total: 0, failed: 0, enriched: 0 });
  };
  const close = () => { if (phase !== 'saving') { reset(); onClose(); } };

  const take = async (files: File[]) => {
    if (!files.length) return;
    setError(null);
    const r = await readImportFiles(files);
    if (!r.rows.length) {
      setError(r.skipped.length
        ? `場所を読めませんでした(${r.skipped.join('、')})。Takeout の「保存済み」の .csv か「保存した場所.json」、またはその ZIP を選んでください`
        : '場所がありませんでした');
      return;
    }
    const marked = markDuplicates(r.rows, spots);
    setRows(marked);
    setPicked(new Set(marked.filter((x) => !x.duplicateOf).map((x) => x.key)));
    setNote(`${r.files.join('・')} から ${marked.length} 件を読みました`
      + `${r.skipped.length ? `(読めなかったファイル: ${r.skipped.join('、')})` : ''}`);
    setPhase('review');
  };

  const counts = useMemo(() => ({
    dup: rows.filter((r) => r.duplicateOf).length,
    located: rows.filter((r) => r.latitude !== null).length,
  }), [rows]);

  const run = async () => {
    const targets = rows.filter((r) => picked.has(r.key));
    if (!targets.length) return;
    setPhase('saving');
    setError(null);
    let failed = 0;
    let enriched = 0;
    const needPlace: WishSpot[] = [];
    setProgress({ done: 0, total: targets.length, failed: 0, enriched: 0 });
    for (const [i, r] of targets.entries()) {
      try {
        const s = await createWishSpot({
          name: r.name, category, description: r.note, address: r.address, latitude: r.latitude, longitude: r.longitude,
          urls: r.url ? [{ url: r.url, label: 'Google マップ' }] : null,
        });
        if (r.latitude === null) needPlace.push(s);
      } catch (e) {
        failed += 1;
        if (failed === 1) setError(errorDetailMessage(e, `「${r.name}」を保存できませんでした`));
      }
      setProgress({ done: i + 1, total: targets.length, failed, enriched });
    }
    if (enrich) {
      for (const s of needPlace.slice(0, ENRICH_MAX)) {
        try {
          const res = await enrichWishSpot(s.id);
          if (res.filled.length) enriched += 1;
        } catch { /* 見つからない・つながらない時はそのまま(保存は済んでいる) */ }
        setProgress((p) => ({ ...p, enriched }));
      }
    }
    setPhase('done');
    const saved = targets.length - failed;
    onDone(`Google マップのリストから ${saved} 件を行きたい場所に取り込みました`
      + `${enriched ? `(${enriched} 件は住所・位置も入れました)` : ''}${failed ? `。${failed} 件は保存できませんでした` : ''}`);
  };

  const toggle = (key: string) => setPicked((s) => {
    const n = new Set(s);
    if (n.has(key)) n.delete(key); else n.add(key);
    return n;
  });
  const takeout = safeExternalUrl(TAKEOUT);

  return (
    <Modal isOpen={isOpen} onClose={close} title="Google マップの保存リストから取り込む" size="lg">
      <div className="space-y-3 text-sm text-ink-900" data-testid="google-import">
        {phase === 'choose' && (
          <>
            <ol className="list-decimal space-y-1 pl-5" data-testid="google-import-steps">
              <li>
                {takeout ? <a href={takeout} target="_blank" rel="noopener noreferrer" className="font-semibold text-accent underline">
                  Google データ エクスポート(Takeout)<ExternalLink size={12} className="inline ml-0.5" aria-hidden="true" />
                  <span className="sr-only">(新しいタブで開く)</span></a> : 'Google データ エクスポート(Takeout)'}
                を開き、「選択をすべて解除」してから<b>「保存済み」</b>にチェックを入れます(位置も欲しい時は「マップ(マイプレイス)」も)。
              </li>
              <li>「次のステップ」→「エクスポートを作成」。届いた ZIP をダウンロードします。</li>
              <li>その ZIP か、中の「行ってみたい.csv」などをここで選びます(複数のリストもまとめて選べます)。</li>
            </ol>
            <p className="text-xs text-ink-700">ファイルはこの端末の中で読みます(サーバーへは送りません)。保存するのは、選んだ場所の名前・メモ・Google マップの URL・位置だけです。</p>
            <label className={`tc-focus-ring grid min-h-36 cursor-pointer place-items-center rounded-xl border-2 border-dashed p-5 text-center ${over ? 'tc-drop-over' : 'border-cloud-200 bg-cloud-50'}`}
              onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); void take(Array.from(e.dataTransfer.files)); }}
              data-testid="google-import-drop">
              <span className="grid place-items-center gap-1">
                <FileUp size={32} aria-hidden="true" />
                <b>ここに ZIP・CSV・JSON をドラッグ&ドロップ</b>
                <span className="tc-mbtn tc-mbtn--sm tc-mbtn--primary">ファイルを選ぶ</span>
              </span>
              <input ref={input} type="file" multiple accept=".zip,.csv,.json,application/zip,text/csv,application/json" className="sr-only"
                aria-label="Google マップの保存リストのファイル" data-testid="google-import-file"
                onChange={(e) => { const f = Array.from(e.target.files ?? []); e.target.value = ''; void take(f); }} />
            </label>
          </>
        )}

        {phase === 'review' && (
          <>
            {note && <p role="status" className="text-ink-700" data-testid="google-import-note">{note}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <span className="tc-pill">{`選んでいる ${picked.size} / ${rows.length} 件`}</span>
              {counts.dup > 0 && <span className="tc-pill tc-pill--warn" data-testid="google-import-dups">{`既にある ${counts.dup} 件は外しています`}</span>}
              <span className="tc-pill">{`位置あり ${counts.located} 件`}</span>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPicked(new Set(rows.filter((r) => !r.duplicateOf).map((r) => r.key)))}>新しい場所だけ</button>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPicked(new Set(rows.map((r) => r.key)))}>すべて</button>
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => setPicked(new Set())}>すべて外す</button>
            </div>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">種類(まとめて)
                <select className="tc-focus-ring mt-1 block min-h-10 rounded-lg border border-cloud-200 bg-cloud-0 px-2" value={category}
                  onChange={(e) => setCategory(e.target.value)} data-testid="google-import-category">
                  {CATEGORIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
              <label className="inline-flex items-center gap-2 text-sm">
                <input type="checkbox" checked={enrich} onChange={(e) => setEnrich(e.target.checked)} data-testid="google-import-enrich" />
                {`位置の無い場所は、保存の後に名前で住所・位置を探す(最大 ${ENRICH_MAX} 件)`}
              </label>
            </div>
            <ul className="max-h-[50vh] divide-y divide-cloud-200 overflow-y-auto rounded-xl border border-cloud-200" data-testid="google-import-list">
              {rows.map((r) => (
                <li key={r.key} className="flex items-start gap-2 px-3 py-2">
                  <input type="checkbox" className="mt-1" checked={picked.has(r.key)} onChange={() => toggle(r.key)}
                    aria-label={`「${r.name}」を取り込む`} data-testid={`google-import-row-${r.key}`} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <b className="break-words">{r.name}</b>
                      <span className="tc-pill text-[11px]">{r.list}</span>
                      {r.duplicateOf && <span className="tc-pill tc-pill--warn text-[11px]">既にある</span>}
                      {r.latitude !== null
                        ? <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-700"><MapPin size={11} aria-hidden="true" />位置あり</span>
                        : <span className="inline-flex items-center gap-0.5 text-[11px] text-ink-700"><MapPinOff size={11} aria-hidden="true" />位置なし</span>}
                    </span>
                    {(r.address || r.note) && <span className="block truncate text-xs text-ink-700">{[r.address, r.note].filter(Boolean).join(' · ')}</span>}
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary" disabled={!picked.size} onClick={() => void run()}
                data-testid="google-import-run">{`${picked.size} 件を行きたい場所に取り込む`}</button>
              <button type="button" className="tc-focus-ring tc-mbtn" onClick={reset}>ファイルを選び直す</button>
            </div>
          </>
        )}

        {(phase === 'saving' || phase === 'done') && (
          <div role="status" data-testid="google-import-progress">
            <p className="font-semibold">{phase === 'saving' ? `取り込んでいます… ${progress.done} / ${progress.total}` : `取り込みました(${progress.total - progress.failed} 件)`}</p>
            <progress className="mt-2 w-full" max={progress.total || 1} value={progress.done} aria-label="取り込みの進み" />
            {progress.enriched > 0 && <p className="mt-1 text-xs text-ink-700">{`${progress.enriched} 件は住所・位置も入れました(出典: OpenStreetMap など)`}</p>}
            {phase === 'done' && (
              <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary mt-3" onClick={close} data-testid="google-import-close">閉じる</button>
            )}
          </div>
        )}
        {error && <p role="alert" className="text-danger">{error}</p>}
      </div>
    </Modal>
  );
};

export default GoogleSavedImportDialog;
