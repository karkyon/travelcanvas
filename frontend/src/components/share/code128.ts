/**
 * [Gate Remaining-1] FR-012 バーコード(Code 128)を端末の中で作る(外部のサービスへ送らない)。
 * 印字できる ASCII(32〜126)は Code 128 B、数字だけで偶数桁なら Code 128 C(短くなる)。それ以外は作れない(null)。
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212',
  '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132', '221231', '213212', '223112', '312131',
  '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321',
  '112313', '132113', '132311', '211313', '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121',
  '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114',
  '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111', '111242', '121142', '121241', '114212',
  '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113',
  '114311', '411113', '411311', '113141', '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];
const START_B = 104;
const START_C = 105;
const STOP = 106;

/** 符号の番号の並び(開始・データ・検査・終了)。作れない時は null */
export function code128Values(text: string): number[] | null {
  if (!text || text.length > 80) return null;
  let values: number[];
  if (/^\d+$/.test(text) && text.length % 2 === 0 && text.length >= 4) {
    values = [START_C];
    for (let i = 0; i < text.length; i += 2) values.push(Number(text.slice(i, i + 2)));
  } else {
    values = [START_B];
    for (const ch of text) {
      const c = ch.charCodeAt(0);
      if (c < 32 || c > 126) return null;
      values.push(c - 32);
    }
  }
  let sum = values[0]!;
  for (let i = 1; i < values.length; i += 1) sum += values[i]! * i;
  values.push(sum % 103, STOP);
  return values;
}

/** 黒白の幅の並び(先頭は黒)。静かな余白は含めない */
export function code128Widths(text: string): number[] | null {
  const v = code128Values(text);
  if (!v) return null;
  return v.flatMap((n) => PATTERNS[n]!.split('').map(Number));
}

/** SVG の文字列(高さ h、1 単位 = 2px、左右に 10 単位の余白) */
export function code128Svg(text: string, h = 80): string | null {
  const widths = code128Widths(text);
  if (!widths) return null;
  const unit = 2;
  const quiet = 10;
  const total = widths.reduce((a, b) => a + b, 0) + quiet * 2;
  let x = quiet;
  const rects: string[] = [];
  widths.forEach((w, i) => {
    if (i % 2 === 0) rects.push(`<rect x="${x * unit}" y="0" width="${w * unit}" height="${h}"/>`);
    x += w;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total * unit} ${h}" width="${total * unit}" height="${h}">` +
    `<rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
}

/** 形式の名前が 1 次元のバーコード(Code 128 など)か。それ以外は QR で描く */
export function isLinearFormat(format: string | null | undefined): boolean {
  return /code[\s_-]?128|barcode|1d|linear/i.test(format ?? '');
}
