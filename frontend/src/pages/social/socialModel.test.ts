import { describe, it, expect } from 'vitest';
import { charInfo, fadeAt, frameSeconds, move, pickMime, plannedSeconds, safeRect, toggleTag, zoomAt, photoRange } from './socialModel';

describe('リールの計算 (FR-063)', () => {
  it('安全な範囲: 1080×1920 で上 230・下 422・右 162 を避ける', () => {
    const r = safeRect();
    expect(r.y).toBe(230);
    expect(1920 - (r.y + r.h)).toBeGreaterThanOrEqual(420);
    expect(1080 - (r.x + r.w)).toBeGreaterThanOrEqual(160);
  });
  it('1 コマの時間は 1.5〜4 秒', () => {
    expect(frameSeconds(30, 10)).toBe(3);
    expect(frameSeconds(15, 20)).toBe(1.5);
    expect(frameSeconds(60, 3)).toBe(4);
    expect(plannedSeconds(30, 10, true)).toBe(34);
    expect(plannedSeconds(60, 20, true)).toBe(60);
  });
  it('形式の選び: MP4 を先に。無ければ WebM', () => {
    expect(pickMime((m) => m === 'video/mp4')).toEqual({ mime: 'video/mp4', ext: 'mp4', mp4: true });
    expect(pickMime((m) => m.startsWith('video/webm'))?.mime).toBe('video/webm;codecs=vp9');
    expect(pickMime(() => false)).toBeNull();
    expect(pickMime(() => { throw new Error('x'); })).toBeNull();
  });
  it('字数の目安とハッシュタグの札', () => {
    expect(charInfo('あ'.repeat(141), 'x')).toMatchObject({ count: 141, limit: 140, over: true });
    expect(charInfo('a', 'tiktok').note).toBe('画面に出るのは最初の 2 行ほど');
    const t = '伊勢へ1泊2日。\n#伊勢 #旅の記録';
    expect(toggleTag(t, '#伊勢')).toBe('伊勢へ1泊2日。\n#旅の記録');
    expect(toggleTag(t, '#赤福')).toBe('伊勢へ1泊2日。\n#伊勢 #旅の記録 #赤福');
    expect(toggleTag('伊勢へ。', '#伊勢')).toBe('伊勢へ。\n#伊勢');
  });
  it('並べ替え・枚数の範囲・寄りと重ね', () => {
    expect(move(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
    expect(move(['a', 'b'], 0, -1)).toEqual(['a', 'b']);
    expect(photoRange('tiktok')).toEqual([3, 20]);
    expect(photoRange('instagram')).toEqual([1, 10]);
    expect(zoomAt(0, 3)).toBe(1);
    expect(zoomAt(3, 3)).toBeCloseTo(1.08);
    expect(fadeAt(0.15, 3)).toBeCloseTo(0.5);
    expect(fadeAt(1.5, 3)).toBe(1);
  });
});
