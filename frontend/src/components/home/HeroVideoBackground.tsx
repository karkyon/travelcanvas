/**
 * [Gate HomeHeroVideo] HOME の表紙の背景の動画(最大 4 場面を 7 秒ごとに短いクロスフェードで切り替える)。
 *
 * - 背景の飾り(aria-hidden・音声なし・muted・playsInline)。見出し・説明・ボタンの位置や押せる状態は変えない
 * - 4本を一度に読まない: 初めは今の場面だけ。次の場面は切り替えの少し前(HERO_PRELOAD_LEAD_MS)に読み始める
 * - タブが隠れた・表紙が画面の外の間は、再生とタイマーを止める(戻ると残りの時間から続ける)
 * - 動きを減らす設定(prefers-reduced-motion)・データ節約(Save-Data)の時は、最初の場面の静止画だけ(動画を読まない)
 * - 読めない場面は飛ばす。全て読めない・素材が無い時は fallback(以前の山並みの絵)
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  HERO_FADE_MS, HERO_PRELOAD_LEAD_MS, HERO_ROTATE_MS, HERO_SCENES, type HeroScene,
} from '@/config/heroVideos';

type NavigatorWithConnection = Navigator & { connection?: { saveData?: boolean } };

function prefersStill(): boolean {
  try {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true;
  } catch {
    // matchMedia が無い環境は動きを止める理由にしない
  }
  return Boolean((navigator as NavigatorWithConnection).connection?.saveData);
}

export interface HeroVideoBackgroundProps {
  fallback: React.ReactNode;
  scenes?: HeroScene[];
  rotateMs?: number;
}

const HeroVideoBackground: React.FC<HeroVideoBackgroundProps> = ({ fallback, scenes = HERO_SCENES, rotateMs = HERO_ROTATE_MS }) => {
  const list = useMemo(() => scenes.slice(0, 4), [scenes]);
  const [still] = useState(prefersStill);
  const [index, setIndex] = useState(0);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  /** 読み始めた場面(src を付けた場面)。今の場面と次の場面だけ */
  const [loaded, setLoaded] = useState<Record<string, boolean>>(() => (list[0] ? { [list[0].id]: true } : {}));
  const [running, setRunning] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);
  const videos = useRef<Record<string, HTMLVideoElement | null>>({});
  const remaining = useRef(rotateMs);
  const startedAt = useRef(0);

  const usable = useMemo(() => list.filter((s) => !failed[s.id]), [list, failed]);
  const current = list[index] && !failed[list[index].id] ? list[index] : usable[0];
  const nextOf = useCallback((from: number): number => {
    for (let step = 1; step <= list.length; step += 1) {
      const i = (from + step) % list.length;
      if (!failed[list[i]!.id]) return i;
    }
    return from;
  }, [list, failed]);

  // タブが隠れた・表紙が画面の外の間は止める
  useEffect(() => {
    if (still || list.length === 0) return undefined;
    let visible = !document.hidden;
    let inView = true;
    const update = () => setRunning(visible && inView);
    const onVis = () => { visible = !document.hidden; update(); };
    document.addEventListener('visibilitychange', onVis);
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function' && rootRef.current) {
      io = new IntersectionObserver((entries) => {
        inView = entries.some((e) => e.isIntersecting);
        update();
      });
      io.observe(rootRef.current);
    }
    return () => { document.removeEventListener('visibilitychange', onVis); io?.disconnect(); };
  }, [still, list.length]);

  // 再生・一時停止(今の場面だけ再生する)
  useEffect(() => {
    if (still || !current) return;
    for (const s of list) {
      const v = videos.current[s.id];
      if (!v) continue;
      if (s.id === current.id && running) {
        const p = v.play?.();
        if (p && typeof p.catch === 'function') p.catch(() => undefined); // 自動再生を断られても静止画で表示を続ける
      } else {
        v.pause?.();
      }
    }
  }, [still, current, running, list]);

  // 切り替えのタイマー(止めた時は残りの時間を覚え、再開でそこから続ける)
  useEffect(() => {
    if (still || usable.length < 2 || !running || !current) return undefined;
    const from = list.indexOf(current);
    const next = list[nextOf(from)]!;
    startedAt.current = Date.now();
    const wait = remaining.current;
    const preload = window.setTimeout(() => setLoaded((l) => (l[next.id] ? l : { ...l, [next.id]: true })),
      Math.max(0, wait - HERO_PRELOAD_LEAD_MS));
    const turn = window.setTimeout(() => {
      remaining.current = rotateMs;
      setLoaded((l) => (l[next.id] ? l : { ...l, [next.id]: true }));
      setIndex(list.indexOf(next));
    }, wait);
    return () => {
      window.clearTimeout(preload);
      window.clearTimeout(turn);
      remaining.current = Math.max(0, wait - (Date.now() - startedAt.current));
    };
  }, [still, usable.length, running, current, list, nextOf, rotateMs]);

  if (list.length === 0 || usable.length === 0) return <>{fallback}</>;
  if (still) {
    const first = usable[0]!;
    return (
      <div className="tc-hero-video" aria-hidden="true" data-testid="hero-video-still">
        <img src={first.poster} alt="" className="tc-hero-video-layer is-active" onError={() => setFailed((f) => ({ ...f, [first.id]: true }))} />
      </div>
    );
  }
  return (
    <div ref={rootRef} className="tc-hero-video" aria-hidden="true" data-testid="hero-video"
      data-scene={current?.id} data-running={running ? 'yes' : 'no'} style={{ ['--tc-hero-fade' as string]: `${HERO_FADE_MS}ms` }}>
      {list.map((s) => (failed[s.id] ? null : (
        <video key={s.id} ref={(el) => { videos.current[s.id] = el; }} data-testid={`hero-video-${s.id}`}
          className={`tc-hero-video-layer${current?.id === s.id ? ' is-active' : ''}`}
          muted playsInline loop preload={loaded[s.id] ? 'auto' : 'none'} poster={s.poster}
          onError={() => {
            setFailed((f) => ({ ...f, [s.id]: true }));
            if (current?.id === s.id) { remaining.current = rotateMs; setIndex(nextOf(list.indexOf(s))); }
          }}>
          {loaded[s.id] && s.sources.map((src) => (
            <source key={src.src} src={src.src} type={src.type}
              onError={src === s.sources[s.sources.length - 1] ? () => {
                setFailed((f) => ({ ...f, [s.id]: true }));
                if (current?.id === s.id) { remaining.current = rotateMs; setIndex(nextOf(list.indexOf(s))); }
              } : undefined} />
          ))}
        </video>
      )))}
    </div>
  );
};

export default HeroVideoBackground;
