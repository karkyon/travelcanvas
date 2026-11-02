/**
 * [Gate HomeHeroVideo] 表紙の背景の動画: 7秒ごとに順に切り替える・一度に全てを読まない・隠れた間は止める・
 * 動きを減らす設定では静止画・読めない場面は飛ばす・素材が無い時は以前の絵。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import HeroVideoBackground from './HeroVideoBackground';
import type { HeroScene } from '@/config/heroVideos';

const scene = (id: string): HeroScene => ({ id, label: id, poster: `/hero/v1/${id}.jpg`,
  sources: [{ src: `/hero/v1/${id}.webm`, type: 'video/webm' }, { src: `/hero/v1/${id}.mp4`, type: 'video/mp4' }] });
const SCENES = ['a', 'b', 'c', 'd'].map(scene);

let ioCallback: ((entries: Array<{ isIntersecting: boolean }>) => void) | null = null;
function setReducedMotion(on: boolean) {
  Object.defineProperty(window, 'matchMedia', { configurable: true, writable: true,
    value: (q: string) => ({ matches: on && q.includes('reduce'), media: q, addEventListener() {}, removeEventListener() {} }) });
}

beforeEach(() => {
  vi.useFakeTimers();
  setReducedMotion(false);
  (globalThis as unknown as { IntersectionObserver: unknown }).IntersectionObserver = class {
    constructor(cb: typeof ioCallback) { ioCallback = cb; }
    observe() {}
    disconnect() {}
  };
  Object.defineProperty(HTMLMediaElement.prototype, 'play', { configurable: true, value: vi.fn(() => Promise.resolve()) });
  Object.defineProperty(HTMLMediaElement.prototype, 'pause', { configurable: true, value: vi.fn() });
});
afterEach(() => { vi.useRealTimers(); ioCallback = null; });

const active = () => screen.getByTestId('hero-video').getAttribute('data-scene');
const sourcesOf = (id: string) => screen.getByTestId(`hero-video-${id}`).querySelectorAll('source').length;

describe('HOME の表紙の背景の動画', () => {
  it('素材が無い時は以前の絵(画面は変わらない)', () => {
    render(<HeroVideoBackground fallback={<svg data-testid="landscape" />} scenes={[]} />);
    expect(screen.getByTestId('landscape')).toBeInTheDocument();
    expect(screen.queryByTestId('hero-video')).toBeNull();
  });

  it('4場面を 7秒ごとに順に切り替え、最初は今の場面だけを読む(次は切り替えの少し前)', () => {
    render(<HeroVideoBackground fallback={null} scenes={SCENES} />);
    expect(active()).toBe('a');
    expect(sourcesOf('a')).toBe(2);
    expect(['b', 'c', 'd'].map(sourcesOf)).toEqual([0, 0, 0]);
    expect(screen.getByTestId('hero-video-b')).toHaveAttribute('preload', 'none');
    act(() => { vi.advanceTimersByTime(4400); });
    expect(sourcesOf('b')).toBe(0);
    act(() => { vi.advanceTimersByTime(200); }); // 7000 - 2500 = 4500ms で次を読み始める
    expect(sourcesOf('b')).toBe(2);
    expect(sourcesOf('c')).toBe(0);
    act(() => { vi.advanceTimersByTime(2400); });
    expect(active()).toBe('b');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(active()).toBe('c');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(active()).toBe('d');
    act(() => { vi.advanceTimersByTime(7000); });
    expect(active()).toBe('a');
    const video = screen.getByTestId('hero-video-a') as HTMLVideoElement;
    expect(video.muted).toBe(true);
    expect(screen.getByTestId('hero-video')).toHaveAttribute('aria-hidden', 'true');
  });

  it('タブが隠れた間・画面の外の間はタイマーを止め、戻ると残りの時間から続ける', () => {
    render(<HeroVideoBackground fallback={null} scenes={SCENES} />);
    act(() => { vi.advanceTimersByTime(3000); });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(screen.getByTestId('hero-video')).toHaveAttribute('data-running', 'no');
    act(() => { vi.advanceTimersByTime(60000); });
    expect(active()).toBe('a');
    expect(sourcesOf('b')).toBe(0); // 止めている間は次の場面を読まない
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    act(() => { vi.advanceTimersByTime(3900); });
    expect(active()).toBe('a');
    act(() => { vi.advanceTimersByTime(200); });
    expect(active()).toBe('b');
    act(() => { ioCallback?.([{ isIntersecting: false }]); });
    act(() => { vi.advanceTimersByTime(30000); });
    expect(active()).toBe('b');
    expect(screen.getByTestId('hero-video')).toHaveAttribute('data-running', 'no');
  });

  it('動きを減らす設定では最初の場面の静止画だけ(動画を読まない)', () => {
    setReducedMotion(true);
    render(<HeroVideoBackground fallback={null} scenes={SCENES} />);
    const still = screen.getByTestId('hero-video-still');
    expect(still.querySelector('img')).toHaveAttribute('src', '/hero/v1/a.jpg');
    expect(still.querySelector('video')).toBeNull();
    act(() => { vi.advanceTimersByTime(30000); });
    expect(screen.getByTestId('hero-video-still')).toBeInTheDocument();
  });

  it('読めない場面は飛ばして次へ進む。全て読めない時は以前の絵', () => {
    render(<HeroVideoBackground fallback={<svg data-testid="landscape" />} scenes={SCENES} />);
    const lastA = screen.getByTestId('hero-video-a').querySelectorAll('source')[1]!;
    act(() => { fireEvent.error(lastA); });
    expect(active()).toBe('b');
    expect(screen.queryByTestId('hero-video-a')).toBeNull();
    for (const id of ['b', 'c', 'd']) {
      act(() => { fireEvent.error(screen.getByTestId(`hero-video-${id}`)); });
    }
    expect(screen.getByTestId('landscape')).toBeInTheDocument();
  });
});
