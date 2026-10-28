/** [Gate G9] UX-2 旅行の表紙(画像が無い時の生成の色): 決まった値・季節・白い文字の読みやすさ。 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COVER_PALETTES, COVER_PHOTO_SCRIM, blend, contrastRatio, coverFor, seasonOf } from './tokens';

describe('coverFor', () => {
  it('同じ旅行は常に同じ表紙、季節は開始の月で決まる', () => {
    const a = coverFor({ destination: '京都', title: '紅葉', startDate: '2026-11-04' });
    expect(coverFor({ destination: '京都', title: '紅葉', startDate: '2026-11-04' })).toEqual(a);
    expect(a.season).toBe('autumn');
    expect(coverFor({ destination: '京都', startDate: '2026-04-01' }).season).toBe('spring');
    expect(coverFor({ destination: '沖縄', startDate: '2026-08-01' }).season).toBe('summer');
    expect(coverFor({ destination: '札幌', startDate: '2026-01-20' }).season).toBe('winter');
    expect([seasonOf(3), seasonOf(6), seasonOf(9), seasonOf(12)]).toEqual(['spring', 'summer', 'autumn', 'winter']);
  });

  it('日付が無くても行き先・題名から選び、全ての色で白い文字が 4.5:1 以上', () => {
    const seen = new Set(['京都', '大阪', '那覇', '札幌', 'Paris', 'ソウル', '台北', 'NYC', '金沢', '函館']
      .map((d) => coverFor({ destination: d }).id));
    expect(seen.size).toBeGreaterThan(2);
    expect(coverFor({}).id).toBeTruthy();
    for (const p of COVER_PALETTES) {
      expect(contrastRatio('#ffffff', p.from)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio('#ffffff', p.to)).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('[G11] 表紙の写真の重ね', () => {
  it('真っ白・明るい色の写真でも、重ねの上の白い文字は 4.5:1 以上', () => {
    for (const photo of ['#ffffff', '#fff8dc', '#ffff00', '#00ffff', '#c0c0c0']) {
      const topEdge = blend(COVER_PHOTO_SCRIM.color, photo, COVER_PHOTO_SCRIM.top);
      expect(contrastRatio('#ffffff', topEdge)).toBeGreaterThanOrEqual(4.5);
    }
    expect(COVER_PHOTO_SCRIM.bottom).toBeGreaterThanOrEqual(COVER_PHOTO_SCRIM.top);
  });

  it('tokens.css の重ねは tokens.ts と同じ値', () => {
    const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');
    expect(css).toContain(`rgba(15, 23, 42, ${COVER_PHOTO_SCRIM.bottom}), rgba(15, 23, 42, ${COVER_PHOTO_SCRIM.top})`);
  });
});
