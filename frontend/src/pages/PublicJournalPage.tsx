/**
 * PublicJournalPage - 公開された旅行記(資格情報なしで見られる。MEM-01、Gate G6)。
 *
 * backend/app/api/v1/memory_publish.py の public_router(GET /public/journal/{token})を読む。
 * 内容は公開した時の写し(作者本人の記録だけ。緯度経度は含まない。場所は「出さない」か「地名だけ」)。
 * 公開をやめた・URL が違う時は「見つかりません」だけを示す(どちらかは区別しない)。
 * 検索エンジンに載せない(API の X-Robots-Tag。画面の index.html も全体で noindex)。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { getPublicJournal, getPublicJournalPhoto } from '@/services/api/g6';
import type { JournalMemory } from '@/services/api';
import type { PublicJournal, RoutePoint } from '@/services/api/types/g6';

const PublicPhoto: React.FC<{ token: string; memoryId: string }> = ({ token, memoryId }) => {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let objectUrl: string | null = null;
    let active = true;
    getPublicJournalPhoto(token, memoryId)
      .then((blob) => {
        if (!active) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => active && setFailed(true));
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [token, memoryId]);
  if (failed) return <p className="text-sm text-ink-700">写真を読み込めませんでした</p>;
  if (!url) return <p className="text-sm text-ink-700">写真を読み込み中…</p>;
  return <img src={url} alt="旅の写真" className="max-h-80 rounded-lg border border-gray-200" />;
};

/** 大まかな移動(約1kmの格子の点)を線で描く。地図の背景・座標の数値は出さない */
const RouteSketch: React.FC<{ route: RoutePoint[] }> = ({ route }) => {
  const path = useMemo(() => {
    if (route.length < 2) return null;
    const lats = route.map((p) => p.lat);
    const lngs = route.map((p) => p.lng);
    const [minLat, maxLat, minLng, maxLng] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
    const span = Math.max(maxLat - minLat, maxLng - minLng) || 1;
    return route.map((p, i) => {
      const x = 10 + ((p.lng - minLng) / span) * 180;
      const y = 190 - ((p.lat - minLat) / span) * 180;
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
  }, [route]);
  if (!path) return null;
  return (
    <figure className="mt-4">
      <svg viewBox="0 0 200 200" className="w-48 h-48 border border-gray-200 rounded-lg bg-surface" role="img"
        aria-label={`大まかな移動の形(${route.length}地点)`}>
        <path d={path} fill="none" stroke="#1d4ed8" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />
      </svg>
      <figcaption className="text-xs text-ink-700 mt-1">大まかな移動の形です(約1kmごとにまとめ、出発と帰着の近くは出していません)。</figcaption>
    </figure>
  );
};

const MemoryItem: React.FC<{ token: string; memory: JournalMemory; photoIds: Set<string> }> = ({ token, memory, photoIds }) => (
  <li className="space-y-1">
    {memory.body && <p className="text-ink-900 whitespace-pre-wrap">{memory.body}</p>}
    {memory.place_name && <p className="text-sm text-ink-700">{memory.place_name}</p>}
    {memory.kind === 'photo' && photoIds.has(memory.id) && <PublicPhoto token={token} memoryId={memory.id} />}
  </li>
);

const PublicJournalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<PublicJournal | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    getPublicJournal(token)
      .then((j) => {
        if (!active) return;
        setData(j);
        document.title = `${j.title} - 旅行記`;
      })
      .catch((e: unknown) => {
        if (!active) return;
        const status = (e as { response?: { status?: number } } | null)?.response?.status;
        setError(status === 429 ? 'アクセスが多すぎます。しばらく待ってから開いてください。'
          : status === 404 ? 'この旅行記は見つかりません(公開が終わったか、URL が違います)。'
            : '旅行記を読み込めませんでした。通信の状態を確かめてください。');
      });
    return () => {
      active = false;
    };
  }, [token]);

  if (error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-12">
        <h1 className="text-xl font-bold text-ink-900">旅行記</h1>
        <p className="mt-4 text-ink-900" role="alert">{error}</p>
      </div>
    );
  }
  if (!data || !token) return <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>;
  const photoIds = new Set(data.photo_ids);

  return (
    <article className="max-w-2xl mx-auto px-4 py-8" aria-label="公開した旅行記">
      <h1 className="text-2xl font-bold text-ink-900">{data.title}</h1>
      {data.published_at && (
        <p className="text-sm text-ink-700 mt-1">{`${new Date(data.published_at).toLocaleDateString('ja-JP')} 公開`}</p>
      )}
      {data.route.length > 1 && <RouteSketch route={data.route} />}
      {data.days.map((d) => {
        const entries = d.entries.filter((e) => e.memories.length > 0);
        if (entries.length === 0 && d.day_memories.length === 0) return null;
        return (
          <section key={d.day_id} aria-label={d.date} className="mt-6">
            <h2 className="text-lg font-semibold text-ink-900">{d.title ? `${d.date} ${d.title}` : d.date}</h2>
            {entries.map((e) => (
              <article key={e.event_id} className="mt-3">
                <h3 className="font-medium text-ink-900">{[e.planned_time, e.title].filter(Boolean).join(' ')}</h3>
                <ul className="mt-1 space-y-2">
                  {e.memories.map((v) => <MemoryItem key={v.id} token={token} memory={v} photoIds={photoIds} />)}
                </ul>
              </article>
            ))}
            {d.day_memories.length > 0 && (
              <ul className="mt-3 space-y-2">
                {d.day_memories.map((v) => <MemoryItem key={v.id} token={token} memory={v} photoIds={photoIds} />)}
              </ul>
            )}
          </section>
        );
      })}
      {data.other_memories.length > 0 && (
        <section aria-label="そのほかの記録" className="mt-6">
          <h2 className="text-lg font-semibold text-ink-900">そのほかの記録</h2>
          <ul className="mt-2 space-y-2">
            {data.other_memories.map((v) => <MemoryItem key={v.id} token={token} memory={v} photoIds={photoIds} />)}
          </ul>
        </section>
      )}
      <p className="text-xs text-ink-700 mt-10">TravelCanvas で作った旅行記です。</p>
    </article>
  );
};

export default PublicJournalPage;
