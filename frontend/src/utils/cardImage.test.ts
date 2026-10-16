import { describe, it, expect, vi } from 'vitest';
import { FORMATS, STYLE, decodeBase64, layoutCard, saveDataUrl, wrap, type CardInput, type Measure } from './cardImage';

// 1文字 = 文字サイズ と見なす測り方
const last = <T,>(a: T[]): T => a[a.length - 1]!;

const measure: Measure = (text, size) => Array.from(text).length * size;

const input = (lines: number, warning: string | null = null): CardInput => ({
  title: '京都の旅', subtitle: '2026-11-01 〜 2026-11-02',
  sections: [{ heading: '11/1(日)', lines: Array.from({ length: lines }, (_, i) => `${String(i).padStart(2, '0')}:00 予定${i}`) }],
  footer: ['生成 2026-10-16 10:00・旅程の版 r5(最新)', '予約番号・住所・電話・参加者名・QRは含めていません'], warning,
});

describe('cardImage (Gate P16)', () => {
  it('幅に合わせて折り返す', () => {
    expect(wrap('あいうえおかきくけこ', 10, 40, measure)).toEqual(['あいうえ', 'おかきく', 'けこ']);
    expect(wrap('', 10, 40, measure)).toEqual(['']);
  });

  it('1ページに収まる時は1ページ、各ページに生成情報とページ番号を書く', () => {
    const pages = layoutCard(input(5, '旅程が更新されています'), 'phone', measure);
    expect(pages).toHaveLength(1);
    expect(pages[0]!.width).toBe(FORMATS.phone.width);
    const kinds = pages[0]!.ops.map((o) => o.kind);
    expect(kinds.filter((k) => k === 'line')).toHaveLength(5);
    expect(kinds).toContain('warning');
    expect(pages[0]!.ops.filter((o) => o.kind === 'footer').map((o) => o.text).join('')).toContain('含めていません');
    expect(last(pages[0]!.ops)).toMatchObject({ kind: 'page', text: '1 / 1' });
    // 本文はフッターより上
    const lastLine = last(pages[0]!.ops.filter((o) => o.kind === 'line'));
    const firstFooter = pages[0]!.ops.find((o) => o.kind === 'footer')!;
    expect(lastLine.y).toBeLessThan(firstFooter.y);
  });

  it('入りきらない時はページを分け、2ページ目にも見出し(タイトル)を描く', () => {
    const pages = layoutCard(input(60), 'square', measure);
    expect(pages.length).toBeGreaterThan(1);
    const all = pages.flatMap((p) => p.ops.filter((o) => o.kind === 'line'));
    expect(all).toHaveLength(60);
    expect(pages[1]!.ops[0]).toMatchObject({ kind: 'title', text: '京都の旅' });
    expect(last(last(pages).ops).text).toBe(`${pages.length} / ${pages.length}`);
    for (const p of pages) {
      const footerTop = Math.min(...p.ops.filter((o) => o.kind === 'footer').map((o) => o.y));
      for (const o of p.ops.filter((x) => x.kind === 'line')) expect(o.y).toBeLessThan(footerTop);
      expect(Math.max(...p.ops.map((o) => o.y))).toBeLessThanOrEqual(FORMATS.square.height - STYLE.margin);
    }
  });
});

describe('saveDataUrl (Gate P16)', () => {
  it('base64を復号する', () => {
    expect(Array.from(decodeBase64('iVBORw0KGgo='))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(Array.from(decodeBase64('QQ=='))).toEqual([65]);
    expect(decodeBase64('').length).toBe(0);
  });

  it('data URLをBlobにして、ファイル名を付けて保存する', () => {
    const blobs: Blob[] = [];
    window.URL.createObjectURL = vi.fn((b: Blob) => { blobs.push(b); return 'blob:x'; });
    window.URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    const spy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      names.push(this.download);
    });
    saveDataUrl('data:image/png;base64,iVBORw0K', 'a.png');
    spy.mockRestore();
    expect(names).toEqual(['a.png']);
    expect(blobs[0]!.type).toBe('image/png');
    expect(blobs[0]!.size).toBe(6);
  });
});
