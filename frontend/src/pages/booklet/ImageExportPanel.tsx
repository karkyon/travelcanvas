/**
 * [Gate P16] しおりの画像出力パネル(FR-046 画像出力、DOC-04 SC-36 Export Preview、DOC-15 CA-004)。
 *
 * - 範囲(旅行全体 / 1日)と形式(スマートフォン縦長 / 正方形)を選び、端末の中でPNG画像を作る(画像はサーバーへ送らない)
 * - 作る前に、含める情報と含めない情報を示す。画像は機密項目(予約番号・住所・電話・参加者名)を含めない投影から作る
 *   (しおりの「含める項目」の設定にかかわらず、画像では常に含めない)
 * - 旅程が投影の後に更新されていれば警告し、画像にも警告と版を書く
 */
import React, { useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { previewBooklet } from '@/services/api';
import type { Booklet, BookletOptions } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import { CanvasUnavailableError, FORMATS, renderCard, saveDataUrl, type CardFormat } from '@/utils/cardImage';
import { EXCLUDED_NOTE, buildCard, fileName } from './imageCards';

const SAFE_INCLUDES = { confirmation_numbers: false, addresses: false, phones: false, participants: false };

interface Props {
  planId: string;
  options: BookletOptions;
}

const ImageExportPanel: React.FC<Props> = ({ planId, options }) => {
  const [scope, setScope] = useState('trip');
  const [format, setFormat] = useState<CardFormat>('phone');
  const [source, setSource] = useState<Booklet | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setImages([]);
    try {
      // 画像は機密項目を含めない投影から作る(章は表紙と日程だけ)
      const b = await previewBooklet(planId, { ...options, sections: ['cover', 'schedule'], includes: SAFE_INCLUDES });
      setSource(b);
      const days = b.schedule?.days ?? [];
      const target = scope === 'trip' || days.some((d) => d.date === scope) ? scope : 'trip';
      setImages(renderCard(buildCard(b, target), format));
    } catch (e) {
      setError(e instanceof CanvasUnavailableError ? e.message : errorDetailMessage(e, '画像を作れませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const days = source?.schedule?.days ?? [];
  const title = source?.cover?.title ?? 'しおり';

  return (
    <Card padding="md">
      <section aria-label="画像として保存" className="space-y-3">
        <h2 className="font-semibold text-gray-900">画像として保存</h2>
        <p className="text-sm text-gray-700">
          LINEなどで送りやすい画像(PNG)を、この端末の中で作ります。
        </p>
        <div className="text-sm text-gray-800 space-y-1">
          <p>含める: 旅行名・日付・予定の時刻と名前・場所の名前・移動(出発・区間・所要時間)</p>
          <p>{`含めない: ${EXCLUDED_NOTE.replace('は含めていません', '')}(しおりの設定にかかわらず)`}</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <label className="text-sm text-gray-800">範囲
            <select className="block mt-1 border rounded px-2 py-1" value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value="trip">旅行全体</option>
              {days.map((d) => <option key={d.date} value={d.date}>{`${d.date}の1日`}</option>)}
            </select>
          </label>
          <label className="text-sm text-gray-800">形式
            <select className="block mt-1 border rounded px-2 py-1" value={format} onChange={(e) => setFormat(e.target.value as CardFormat)}>
              {(Object.keys(FORMATS) as CardFormat[]).map((f) => <option key={f} value={f}>{FORMATS[f].label}</option>)}
            </select>
          </label>
        </div>
        {days.length === 0 && <p className="text-xs text-gray-700">1日だけの画像は、一度「画像を作る」と日付を選べるようになります。</p>}
        <Button size="sm" variant="primary" disabled={busy} onClick={generate}>{busy ? '作っています…' : '画像を作る'}</Button>
        {error && <p className="text-sm text-red-800" role="alert">{error}</p>}
        {source?.is_stale && <p className="text-sm text-amber-900" role="status">旅程がこの後に更新されています。もう一度「画像を作る」を押してください。</p>}
        {images.length > 0 && (
          <ul className="space-y-3" aria-label="作った画像">
            {images.map((src, i) => (
              <li key={src.slice(-32) + i} className="space-y-1">
                <img src={src} alt={`${title}の画像(${i + 1}/${images.length})`} className="w-40 border border-gray-300 rounded" />
                <Button size="sm" variant="outline" onClick={() => saveDataUrl(src, fileName(title, scope, i + 1, images.length))}>
                  {`画像を保存(${i + 1}/${images.length})`}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
};

export default ImageExportPanel;
