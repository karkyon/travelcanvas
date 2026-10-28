/**
 * [Gate G6] MEM-01 旅行記の公開(公開の前に内容と確認の項目を見せ、全て確かめた時だけ公開する)と、公開の失効。
 *
 * - 公開するのは自分の記録だけ(他のメンバーの記録・音声・座標は含めない)。場所は「出さない」か「地名だけ」。
 * - 地名だけの時も、守る範囲(自宅など)の中の地名は出さない。移動の記録は両端を切り落とし、約1kmの格子にまとめる。
 * - URL は作った時だけ表示する(サーバーには URL の照合用の値だけを残すため、後から同じ URL は分からない)。
 */
import React, { useCallback, useEffect, useState } from 'react';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import {
  createPublication, getPublications, previewPublication, revokePublication,
} from '@/services/api/g6';
import type { JournalLocationLevel, MemoryPublication, PublicationPreview } from '@/services/api/types/g6';
import { errorDetailMessage } from '@/utils/apiErrorDetail';

const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleString('ja-JP') : '—');

interface Props {
  planId: string;
  onMessage: (message: string) => void;
  onError: (message: string | null) => void;
}

const JournalPublishCard: React.FC<Props> = ({ planId, onMessage, onError }) => {
  const [level, setLevel] = useState<JournalLocationLevel>('none');
  const [photos, setPhotos] = useState(false);
  const [title, setTitle] = useState('');
  const [preview, setPreview] = useState<PublicationPreview | null>(null);
  const [acks, setAcks] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<string | null>(null);
  const [items, setItems] = useState<MemoryPublication[]>([]);

  const loadList = useCallback(async () => {
    try {
      setItems(await getPublications(planId));
    } catch {
      setItems([]);
    }
  }, [planId]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // 選び方を変えたら、確認をやり直す(確認の項目は選び方で変わる)
  const resetPreview = () => {
    setPreview(null);
    setAcks(new Set());
  };

  const options = () => ({ location_level: level, include_photos: photos, ...(title.trim() ? { title: title.trim() } : {}) });

  const doPreview = async () => {
    onError(null);
    setCreated(null);
    setBusy(true);
    try {
      setPreview(await previewPublication(planId, options()));
      setAcks(new Set());
    } catch (e) {
      onError(errorDetailMessage(e, '公開する内容を確認できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const allChecked = preview ? preview.required_acknowledgements.every((a) => acks.has(a.code)) : false;

  const publish = async () => {
    if (!preview) return;
    onError(null);
    setBusy(true);
    try {
      const p = await createPublication(planId, { ...options(), acknowledge: [...acks] });
      setCreated(p.url ? `${window.location.origin}${p.url}` : null);
      onMessage('旅行記を公開しました。URL はこの画面で今だけ表示します。');
      resetPreview();
      await loadList();
    } catch (e) {
      onError(errorDetailMessage(e, '旅行記を公開できませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (p: MemoryPublication) => {
    onError(null);
    setBusy(true);
    try {
      await revokePublication(planId, p.id);
      onMessage(`「${p.title}」の公開をやめました。URL はすぐに開けなくなります。`);
      await loadList();
    } catch (e) {
      onError(errorDetailMessage(e, '公開をやめられませんでした'));
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created);
      onMessage('公開の URL をコピーしました');
    } catch {
      onError('コピーできませんでした。URL の欄から選択してコピーしてください');
    }
  };

  const memoryCount = preview
    ? preview.days.reduce((n, d) => n + d.day_memories.length + d.entries.reduce((k, e) => k + e.memories.length, 0), 0)
      + preview.other_memories.length
    : 0;

  return (
    <Card padding="md" className="mt-4">
      <section aria-label="旅行記の公開" className="space-y-3">
        <h2 className="font-semibold text-ink-900">旅行記を公開する</h2>
        <p className="text-sm text-ink-700">
          自分の記録だけで旅行記のページを作り、URL を知っている人に見せます。他のメンバーの記録・音声メモ・緯度経度は含めません。
          公開をやめると、URL はすぐに開けなくなります。
        </p>
        <fieldset>
          <legend className="text-sm text-ink-900">場所の出し方</legend>
          <div className="flex flex-wrap gap-3 mt-1">
            <label className="flex items-center gap-1 text-sm text-ink-900">
              <input type="radio" name="journal-level" checked={level === 'none'} onChange={() => { setLevel('none'); resetPreview(); }} />
              出さない
            </label>
            <label className="flex items-center gap-1 text-sm text-ink-900">
              <input type="radio" name="journal-level" checked={level === 'area'} onChange={() => { setLevel('area'); resetPreview(); }} />
              地名と大まかな移動(約1km)だけ
            </label>
          </div>
        </fieldset>
        <label className="flex items-center gap-2 text-sm text-ink-900">
          <input type="checkbox" checked={photos} onChange={(e) => { setPhotos(e.target.checked); resetPreview(); }} />
          写真を含める(撮影場所などの情報は消して出します)
        </label>
        <label className="block text-sm text-ink-900">
          題名(空なら旅行の名前)
          <input className="block w-full mt-1 border rounded-sm px-2 py-1" value={title} maxLength={200}
            onChange={(e) => { setTitle(e.target.value); resetPreview(); }} />
        </label>
        <Button size="sm" variant="outline" loading={busy && !preview} onClick={() => void doPreview()}>公開する内容を確認する</Button>

        {preview && (
          <div className="space-y-2" aria-label="公開する内容">
            <p className="text-sm text-ink-900">
              {`「${preview.title}」: 記録${memoryCount}件・写真${preview.photo_ids.length}枚を公開します。`}
              {preview.hidden_places > 0 && `守る範囲の中の地名${preview.hidden_places}件は出しません。`}
              {preview.location_level === 'area' && `大まかな移動は${preview.route?.length ?? 0}地点です。`}
            </p>
            <ul className="text-sm text-ink-900 list-disc pl-5" aria-label="公開する記録">
              {preview.days.flatMap((d) => [
                ...d.entries.flatMap((e) => e.memories.map((v) => (
                  <li key={v.id}>{`${d.date} ${e.title ?? ''}: ${v.body ?? (v.kind === 'photo' ? '(写真)' : '')}${v.place_name ? `(${v.place_name})` : ''}`}</li>
                ))),
                ...d.day_memories.map((v) => (
                  <li key={v.id}>{`${d.date}: ${v.body ?? (v.kind === 'photo' ? '(写真)' : '')}${v.place_name ? `(${v.place_name})` : ''}`}</li>
                )),
              ])}
              {preview.other_memories.map((v) => (
                <li key={v.id}>{`${v.body ?? (v.kind === 'photo' ? '(写真)' : '')}${v.place_name ? `(${v.place_name})` : ''}`}</li>
              ))}
            </ul>
            {preview.required_acknowledgements.length > 0 && (
              <fieldset className="space-y-1">
                <legend className="text-sm font-medium text-ink-900">公開の前に確かめてください</legend>
                {preview.required_acknowledgements.map((a) => (
                  <label key={a.code} className="flex items-start gap-2 text-sm text-amber-900 bg-amber-50 p-2 rounded-sm">
                    <input type="checkbox" className="mt-1" checked={acks.has(a.code)} onChange={(e) => {
                      const next = new Set(acks);
                      if (e.target.checked) next.add(a.code);
                      else next.delete(a.code);
                      setAcks(next);
                    }} />
                    {a.message}
                  </label>
                ))}
              </fieldset>
            )}
            <Button size="sm" variant="primary" disabled={!allChecked || memoryCount === 0} loading={busy}
              onClick={() => void publish()}>
              この内容で公開する
            </Button>
            {memoryCount === 0 && <p className="text-sm text-ink-700">公開できる自分の記録がありません(旅行記に含める記録を書いてください)。</p>}
          </div>
        )}

        {created && (
          <div className="space-y-1">
            <label className="block text-sm text-ink-900">
              公開の URL(今だけ表示します)
              <input readOnly className="block w-full mt-1 border rounded-sm px-2 py-1 font-mono text-sm" value={created}
                onFocus={(e) => e.target.select()} />
            </label>
            <Button size="sm" variant="outline" onClick={() => void copy()}>URL をコピー</Button>
          </div>
        )}

        {items.length > 0 && (
          <ul className="divide-y" aria-label="公開した旅行記">
            {items.map((p) => (
              <li key={p.id} className="py-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm">
                  <span className="font-medium text-ink-900">{p.title}</span>
                  <span className="block text-ink-700">
                    {`${formatDate(p.created_at)} 公開・閲覧${p.view_count}回・${p.location_level === 'area' ? '地名あり' : '場所なし'}・写真${p.photos}枚`}
                    {!p.is_active && `・公開をやめました(${formatDate(p.revoked_at)})`}
                  </span>
                </span>
                {p.is_active && (
                  <Button size="sm" variant="outline" disabled={busy} aria-label={`${p.title}の公開をやめる`} onClick={() => void revoke(p)}>
                    公開をやめる
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </Card>
  );
};

export default JournalPublishCard;
