/**
 * [Gate MyMaps] Google マイマップを作る案内(提案 SC-51)。
 * マイマップを TC から直接作る公開の手段が確認できないため、KML を保存して本人が Google の画面で取り込む。
 * Google のアカウント情報は TC では一切扱わない。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { Map as MapIcon } from 'lucide-react';
import Card from '@/components/common/Card';
import {
  deleteExternalMap, downloadMyMapsKml, getExternalMaps, getMyMapsPreview, saveExternalMap,
} from '@/services/api/photoFeatures';
import type { ExternalMap, MyMapsPreview } from '@/services/api/photoFeatures';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { safeExternalUrl } from '@/utils/safeNavigation';

export const MYMAPS_URL_RE = /^https:\/\/www\.google\.com\/maps\/d\/[A-Za-z0-9_\-./?=&%#~+]*$/;

const MyMapsCard: React.FC<{ planId: string; planTitle?: string | null }> = ({ planId, planTitle }) => {
  const [exact, setExact] = useState(true);
  const [excludeLodging, setExcludeLodging] = useState(true);
  const [preview, setPreview] = useState<MyMapsPreview | null>(null);
  const [saved, setSaved] = useState<ExternalMap[]>([]);
  const [url, setUrl] = useState('');
  const [share, setShare] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const precision = exact ? 'exact' : 'approx';

  const load = useCallback(async () => {
    setError(null);
    try {
      setPreview(await getMyMapsPreview(planId, precision, excludeLodging));
    } catch (e) {
      setError(errorDetailMessage(e, '地図に載せる地点を読み込めませんでした'));
    }
  }, [planId, precision, excludeLodging]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { getExternalMaps(planId).then(setSaved).catch(() => setSaved([])); }, [planId]);

  const download = async () => {
    setError(null);
    try {
      const blob = await downloadMyMapsKml(planId, precision, excludeLodging);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${(planTitle || 'travelcanvas').replace(/[\\/:*?"<>|]/g, '_')}.kml`;
      link.click();
      URL.revokeObjectURL(link.href);
      setMessage('KML を保存しました。次は Google マイマップで取り込みます。');
    } catch (e) {
      setError(errorDetailMessage(e, 'KML を保存できませんでした'));
    }
  };

  const save = async () => {
    setError(null);
    setMessage(null);
    if (!MYMAPS_URL_RE.test(url.trim())) {
      setError('https://www.google.com/maps/d/ で始まるマイマップのリンクを貼ってください');
      return;
    }
    try {
      const row = await saveExternalMap(planId, url.trim(), share ? 'members' : 'private');
      setSaved((prev) => [row, ...prev.filter((m) => !m.by_me)]);
      setUrl('');
      setMessage('マイマップのリンクを保存しました');
    } catch (e) {
      setError(errorDetailMessage(e, 'リンクを保存できませんでした'));
    }
  };

  const removeMine = async () => {
    try {
      await deleteExternalMap(planId);
      setSaved((prev) => prev.filter((m) => !m.by_me));
    } catch (e) {
      setError(errorDetailMessage(e, 'リンクを解除できませんでした'));
    }
  };

  return (
    <Card padding="md">
      <section aria-labelledby="mymaps-title" data-testid="mymaps-card" className="space-y-3">
        <h2 id="mymaps-title" className="font-semibold text-ink-900 flex items-center gap-2"><MapIcon size={18} aria-hidden="true" />Googleマイマップを作る</h2>
        <p className="text-sm text-ink-700">旅程の場所を日ごとに色分けした KML ファイルを作り、ご自分の Google アカウントのマイマップへ取り込みます。Google のパスワードやアカウント情報は TravelCanvas では扱いません。</p>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {message && <p role="status" className="text-sm text-success">{message}</p>}
        {saved.length > 0 && (
          <ul className="space-y-1" aria-label="保存したマイマップ">
            {saved.map((m) => (
              <li key={m.url} className="flex flex-wrap items-center gap-2 text-sm">
                <a className="tc-focus-ring tc-mbtn tc-mbtn--sm tc-mbtn--primary" href={safeExternalUrl(m.url) ?? undefined} target="_blank" rel="noopener noreferrer">マイマップを開く</a>
                {m.by_me && <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm" onClick={() => void removeMine()}>リンクを解除</button>}
              </li>
            ))}
          </ul>
        )}
        <div>
          <h3 className="text-sm font-semibold text-ink-900">1. 内容を確かめて保存する</h3>
          {preview && (
            <div className="mt-1 space-y-2 text-sm text-ink-800">
              {preview.days.length === 0 && <p>位置のある予定がまだありません。予定に場所を設定すると載せられます。</p>}
              {preview.days.map((d) => (
                <div key={d.date}>
                  <b>{d.date}</b>{` ${d.points.length} か所: `}
                  {d.points.map((p, i) => `${i + 1}. ${p.label}${p.time ? `(${p.time})` : ''}`).join(' / ')}
                  {d.route_urls.length > 0 && (
                    <span className="ml-2 inline-flex flex-wrap gap-2">
                      {d.route_urls.map((u, i) => (
                        <a key={u} className="underline" href={safeExternalUrl(u) ?? undefined} target="_blank" rel="noopener noreferrer">
                          {d.route_urls.length > 1 ? `経路を開く(${i + 1})` : '経路を Google マップで開く'}
                        </a>
                      ))}
                    </span>
                  )}
                </div>
              ))}
              {preview.no_location.length > 0 && <p className="text-warning">{`位置が無いので載りません: ${preview.no_location.map((e) => e.title).join('、')}`}</p>}
              {preview.excluded > 0 && <p>{`宿泊場所・守る範囲のため除外: ${preview.excluded} 件`}</p>}
              {preview.many_days && <p className="text-warning">日数が多いため、マイマップのレイヤの上限(10 と言われています)に当たる可能性があります。</p>}
              {preview.over_limit && <p className="text-warning">地点が多すぎます。マイマップの取り込みは 2,000 行までです。</p>}
            </div>
          )}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <label className="flex items-center gap-2"><input type="radio" name="mymaps-precision" checked={exact} onChange={() => setExact(true)} />正確(約1m単位。地図で使うならこちら)</label>
            <label className="flex items-center gap-2"><input type="radio" name="mymaps-precision" checked={!exact} onChange={() => setExact(false)} />約1km単位に丸める</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={excludeLodging} onChange={(e) => setExcludeLodging(e.target.checked)} />宿泊場所は載せない</label>
          </div>
          <p className="mt-1 text-xs text-ink-700">地図を公開・共有すると、正確な位置も相手に見えます。予約番号・チケット・メモ・参加者名は含めません。</p>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--primary mt-2" disabled={!preview || preview.count === 0 || preview.over_limit} onClick={() => void download()}>KML を保存する</button>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-900">2. Google マイマップで取り込む</h3>
          <ol className="mt-1 list-decimal pl-5 text-sm text-ink-800 space-y-0.5">
            <li><a className="underline" href="https://www.google.com/mymaps" target="_blank" rel="noopener noreferrer">Google マイマップ</a>を開いて「新しい地図を作成」を押す</li>
            <li>地図の名前を付ける</li>
            <li>左のレイヤの「インポート」を押す</li>
            <li>左の「アップロード」を選び、保存した KML ファイルを選ぶ</li>
          </ol>
          <p className="mt-1 text-xs text-ink-700">順路の線は地点の間の直線です。旅程を変えても地図は自動で更新されないので、変えた時はもう一度取り込んでください。</p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-ink-900">3. リンクを保存する(任意)</h3>
          <label className="block text-sm mt-1" htmlFor="mymaps-url">マイマップのリンク</label>
          <input id="mymaps-url" type="url" inputMode="url" className="block w-full mt-1 border rounded-sm px-2 py-1 text-sm" placeholder="https://www.google.com/maps/d/edit?mid=..." value={url} onChange={(e) => setUrl(e.target.value)} />
          <label className="flex items-center gap-2 text-sm mt-1"><input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} />旅行のメンバーにもリンクを見せる</label>
          <button type="button" className="tc-focus-ring tc-mbtn tc-mbtn--sm mt-2" onClick={() => void save()}>リンクを保存</button>
        </div>
      </section>
    </Card>
  );
};

export default MyMapsCard;
