import { describe, it, expect } from 'vitest';
import { readExifGps, snsKeywords } from './findModel';
import { jpegWithGps } from './findModel.fixture';

describe('[SpotFind] 写真の撮影場所・SNS の言葉', () => {
  it('Exif の GPS を読む(リトル・ビッグエンディアン、南・西)。無い時は null', () => {
    expect(readExifGps(jpegWithGps(34.455, 136.725))).toMatchObject({ latitude: 34.455, longitude: 136.725 });
    expect(readExifGps(jpegWithGps(-33.8688, -151.2093, false))).toMatchObject({ latitude: -33.8688, longitude: -151.2093 });
    expect(readExifGps(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeNull();
    expect(readExifGps(new Uint8Array([1, 2, 3]).buffer)).toBeNull();
  });

  it('SNS の投稿の文からハッシュタグ・「」・📍・〜へ行った を拾い、よくある言葉と URL は除く', () => {
    expect(snsKeywords('伊勢神宮に行ってきた!「おかげ横丁」で赤福 #旅行 #鳥羽水族館 📍伊勢市 https://x.com/a/1').keywords)
      .toEqual(['鳥羽水族館', 'おかげ横丁', '伊勢市', '伊勢神宮']);
    expect(snsKeywords('https://www.instagram.com/p/abc')).toEqual({ keywords: [], urlOnly: true });
  });
});
