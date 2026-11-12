import { describe, expect, it } from 'vitest';
import { deflateRawSync } from 'node:zlib';
import {
  coordsFromUrl, dedupeRows, markDuplicates, nameFromUrl, parseCsv, readImportFiles, readZipTexts, rowsFromCsv, rowsFromJson,
} from './googleSavedImport';

const CSV = '﻿Title,Note,URL,Tags,Comment\n'
  + ',,,,\n'
  + '首里そば,"木灰そば、""昼だけ""\n並ぶ",https://www.google.com/maps/place/%E9%A6%96%E9%87%8C%E3%81%9D%E3%81%B0/data=!4m2!3m1!1s0x0:0x1!3d26.2172!4d127.7193,,\n'
  + '伊勢神宮 内宮,,"https://www.google.com/maps/place/%E4%BC%8A%E5%8B%A2%E7%A5%9E%E5%AE%AE/@34.4551,136.7258,17z",,\n'
  + ',,"https://www.google.com/maps/search/35.0116,+135.7681",,\n';

describe('[Gate GoogleSavedImport] Google マップの保存リストを読む', () => {
  it('CSV: 引用符・改行・BOM・空の行に対応し、URL の位置を使う', () => {
    expect(parseCsv('a,"b,""c"""\n1,2')).toEqual([['a', 'b,"c"'], ['1', '2']]);
    const rows = rowsFromCsv(CSV, 'Takeout/保存済み/行ってみたい.csv');
    expect(rows.map((r) => r.name)).toEqual(['首里そば', '伊勢神宮 内宮', '地図のピン(35.0116, 135.7681)']);
    expect(rows[0]!).toMatchObject({ note: '木灰そば、"昼だけ"\n並ぶ', latitude: 26.2172, longitude: 127.7193, list: '行ってみたい' });
    expect(rows[1]!).toMatchObject({ latitude: 34.4551, longitude: 136.7258 });
    expect(rows[2]!).toMatchObject({ latitude: 35.0116, longitude: 135.7681 });
  });

  it('URL の位置・名前(書かれている時だけ)', () => {
    expect(coordsFromUrl('https://maps.google.com/?q=34.1,135.2')).toEqual([34.1, 135.2]);
    expect(coordsFromUrl('https://www.google.com/maps/place/x/data=!4m2!3m1!1s0x1')).toBeNull();
    expect(coordsFromUrl('https://www.google.com/maps/@0.0,0.0,3z')).toBeNull();
    expect(nameFromUrl('https://www.google.com/maps/place/%E8%B5%A4%E7%A6%8F+%E6%9C%AC%E5%BA%97/@34,136')).toBe('赤福 本店');
  });

  it('保存した場所.json(新しい形・古い形)', () => {
    const json = JSON.stringify({ type: 'FeatureCollection', features: [
      { geometry: { coordinates: [136.7232, 34.4622] }, properties: { google_maps_url: 'https://maps.google.com/?cid=1',
        location: { name: 'おかげ横丁', address: '三重県伊勢市宇治中之切町52' } } },
      { geometry: { coordinates: [0, 0] }, properties: { Title: '赤福', 'Google Maps URL': 'https://maps.google.com/?cid=2',
        Location: { Address: '三重県伊勢市', 'Geo Coordinates': { Latitude: '34.4629', Longitude: '136.7240' } } } },
    ] });
    const rows = rowsFromJson(json, '保存した場所.json');
    expect(rows[0]!).toMatchObject({ name: 'おかげ横丁', address: '三重県伊勢市宇治中之切町52', latitude: 34.4622, longitude: 136.7232 });
    expect(rows[1]!).toMatchObject({ name: '赤福', latitude: 34.4629, longitude: 136.724 });
  });

  it('同じ場所はまとめ、既にある場所に印を付ける', () => {
    const a = rowsFromCsv('Title,Note,URL\n赤福 本店,,https://maps.google.com/?q=34.4629,136.7240\n', 'お気に入り.csv');
    const b = rowsFromCsv('Title,Note,URL\n赤福本店,土産,https://maps.google.com/?q=34.4630,136.7241\n', '行ってみたい.csv');
    const rows = dedupeRows([...a, ...b]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!).toMatchObject({ list: 'お気に入り・行ってみたい', note: '土産' });
    const marked = markDuplicates([...rows, ...rowsFromCsv('Title,URL\n鳥羽水族館,\n', 'x.csv')],
      [{ id: 's1', name: '赤福 本店', latitude: 34.463, longitude: 136.724 }]);
    expect(marked.map((r) => r.duplicateOf)).toEqual(['s1', null]);
  });

  it('Takeout の ZIP の中の CSV・JSON を読む', async () => {
    const enc = new TextEncoder();
    const files = [
      { name: 'Takeout/保存済み/行ってみたい.csv', data: enc.encode('Title,Note,URL\n首里城,,https://maps.google.com/?q=26.217,127.719\n') },
      { name: 'Takeout/README.html', data: enc.encode('<p>x</p>') },
    ];
    const zip = makeZip(files);
    const texts = await readZipTexts(zip.buffer as ArrayBuffer);
    expect(texts.map((t) => t.name)).toEqual(['Takeout/保存済み/行ってみたい.csv']);
    expect(texts[0]!.text).toContain('首里城');
    const r = await readImportFiles([new File([zip as BlobPart], 'takeout-1.zip', { type: 'application/zip' }),
      new File(['hello'], 'other.txt')]);
    expect(r.rows.map((x) => x.name)).toEqual(['首里城']);
    expect(r.files).toEqual(['行ってみたい']);
    expect(r.skipped).toEqual(['other.txt']);
  });
});

/** 試験用の小さな ZIP(deflate) */
function makeZip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const comp = new Uint8Array(deflateRawSync(f.data));
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(18, comp.length, true);
    lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true);
    const local = concat([new Uint8Array(lh.buffer), name, comp]);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(20, comp.length, true);
    ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    centrals.push(concat([new Uint8Array(ch.buffer), name]));
    locals.push(local);
    offset += local.length;
  }
  const central = concat(centrals);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, central.length, true); end.setUint32(16, offset, true);
  return concat([...locals, central, new Uint8Array(end.buffer)]);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
