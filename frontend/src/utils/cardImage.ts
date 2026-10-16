/**
 * [Gate P16] しおりの画像出力(FR-046、DOC-15 CA-004)。端末の中で画像(PNG)を描く(サーバーへ画像を送らない)。
 *
 * - 形式: phone=スマートフォン縦長(1080×1920)/ square=LINE等で送りやすい正方形(1080×1080)
 * - 行が入りきらない時はページを分ける(1/2、2/2)。長い行は幅に合わせて折り返す
 * - 各ページの下に、生成日時・旅程の版(最新か)・含めていない情報を必ず書く(CA-004)
 * - レイアウト(どの行をどこに描くか)は文字幅の測り方を渡す純粋関数にし、描画と分ける(試験できるように)
 */
export type CardFormat = 'phone' | 'square';

export const FORMATS: Record<CardFormat, { width: number; height: number; label: string }> = {
  phone: { width: 1080, height: 1920, label: 'スマートフォン縦長(1080×1920)' },
  square: { width: 1080, height: 1080, label: '正方形・LINE向け(1080×1080)' },
};

export interface CardSection {
  heading: string;
  lines: string[];
}

export interface CardInput {
  title: string;
  subtitle: string;
  sections: CardSection[];
  footer: string[];
  warning: string | null;
}

export type DrawOp =
  | { kind: 'title' | 'subtitle' | 'heading' | 'line' | 'footer' | 'warning' | 'page'; text: string; x: number; y: number };

export interface CardPage {
  width: number;
  height: number;
  ops: DrawOp[];
}

export const STYLE = {
  margin: 72,
  title: { size: 64, lineHeight: 84 },
  subtitle: { size: 36, lineHeight: 56 },
  heading: { size: 40, lineHeight: 64 },
  line: { size: 34, lineHeight: 50 },
  footer: { size: 26, lineHeight: 36 },
  warning: { size: 30, lineHeight: 44 },
};

export type Measure = (text: string, size: number) => number;

/** 幅に収まるよう1行を折り返す(文字単位。日本語の文章に合わせる) */
export function wrap(text: string, size: number, maxWidth: number, measure: Measure): string[] {
  if (!text) return [''];
  const out: string[] = [];
  let cur = '';
  for (const ch of Array.from(text)) {
    if (cur && measure(cur + ch, size) > maxWidth) {
      out.push(cur);
      cur = ch.trimStart();
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function layoutCard(input: CardInput, format: CardFormat, measure: Measure): CardPage[] {
  const { width, height } = FORMATS[format];
  const m = STYLE.margin;
  const inner = width - m * 2;
  const footerLines = [...input.footer.flatMap((f) => wrap(f, STYLE.footer.size, inner, measure)), 'P'];
  const footerTop = height - m - footerLines.length * STYLE.footer.lineHeight;
  const pages: DrawOp[][] = [];
  let ops: DrawOp[] = [];
  let y = m;

  const header = () => {
    for (const t of wrap(input.title, STYLE.title.size, inner, measure)) {
      y += STYLE.title.lineHeight;
      ops.push({ kind: 'title', text: t, x: m, y });
    }
    for (const t of wrap(input.subtitle, STYLE.subtitle.size, inner, measure)) {
      y += STYLE.subtitle.lineHeight;
      ops.push({ kind: 'subtitle', text: t, x: m, y });
    }
    if (input.warning) {
      for (const t of wrap(`⚠ ${input.warning}`, STYLE.warning.size, inner, measure)) {
        y += STYLE.warning.lineHeight;
        ops.push({ kind: 'warning', text: t, x: m, y });
      }
    }
    y += 16;
  };
  const newPage = () => {
    pages.push(ops);
    ops = [];
    y = m;
    header();
  };
  header();
  for (const s of input.sections) {
    const headingLines = wrap(s.heading, STYLE.heading.size, inner, measure);
    // 見出しだけがページの最後に残らないよう、見出しと最初の1行が入らなければ次のページへ
    if (y + headingLines.length * STYLE.heading.lineHeight + STYLE.line.lineHeight > footerTop && ops.some((o) => o.kind === 'line')) {
      newPage();
    }
    for (const t of headingLines) {
      y += STYLE.heading.lineHeight;
      ops.push({ kind: 'heading', text: t, x: m, y });
    }
    for (const line of s.lines) {
      for (const t of wrap(line, STYLE.line.size, inner - 24, measure)) {
        if (y + STYLE.line.lineHeight > footerTop) newPage();
        y += STYLE.line.lineHeight;
        ops.push({ kind: 'line', text: t, x: m + 24, y });
      }
    }
    y += 12;
  }
  pages.push(ops);
  const total = pages.length;
  return pages.map((p, i) => {
    let fy = footerTop;
    const footer: DrawOp[] = [];
    for (const t of footerLines.slice(0, -1)) {
      fy += STYLE.footer.lineHeight;
      footer.push({ kind: 'footer', text: t, x: m, y: fy });
    }
    fy += STYLE.footer.lineHeight;
    footer.push({ kind: 'page', text: `${i + 1} / ${total}`, x: m, y: fy });
    return { width, height, ops: [...p, ...footer] };
  });
}

const FONT = '"Hiragino Sans", "Noto Sans JP", "Yu Gothic", sans-serif';
const COLORS: Record<DrawOp['kind'], string> = {
  title: '#111827', subtitle: '#374151', heading: '#1e3a8a', line: '#111827', footer: '#4b5563', warning: '#92400e', page: '#4b5563',
};
const WEIGHT: Partial<Record<DrawOp['kind'], string>> = { title: '700', heading: '700', warning: '700' };
const SIZE: Record<DrawOp['kind'], number> = {
  title: STYLE.title.size, subtitle: STYLE.subtitle.size, heading: STYLE.heading.size, line: STYLE.line.size,
  footer: STYLE.footer.size, warning: STYLE.warning.size, page: STYLE.footer.size,
};

export class CanvasUnavailableError extends Error {}

/** ページを描いてPNG(data URL)を返す。canvasが使えない環境では CanvasUnavailableError */
export function renderCard(input: CardInput, format: CardFormat): string[] {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new CanvasUnavailableError('この端末・ブラウザでは画像を作れません');
  const measure: Measure = (text, size) => {
    ctx.font = `${size}px ${FONT}`;
    return ctx.measureText(text).width;
  };
  return layoutCard(input, format, measure).map((page) => {
    canvas.width = page.width;
    canvas.height = page.height;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, page.width, page.height);
    ctx.fillStyle = '#1e3a8a';
    ctx.fillRect(0, 0, page.width, 16);
    for (const op of page.ops) {
      ctx.font = `${WEIGHT[op.kind] ?? '400'} ${SIZE[op.kind]}px ${FONT}`;
      ctx.fillStyle = COLORS[op.kind];
      ctx.fillText(op.text, op.x, op.y);
    }
    return canvas.toDataURL('image/png');
  });
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64 を bytes にする(環境ごとの atob の差に左右されないよう自前で処理する) */
export function decodeBase64(b64: string): Uint8Array<ArrayBuffer> {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const out = new Uint8Array(new ArrayBuffer(Math.floor((clean.length * 3) / 4)));
  let buf = 0;
  let bits = 0;
  let n = 0;
  for (const ch of clean) {
    buf = (buf << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n] = (buf >> bits) & 0xff;
      n += 1;
    }
  }
  return out.slice(0, n);
}

/** data URL を一時的なBlobのURLにして保存する(data URL のままではブラウザがファイル名を無視するため) */
export function saveDataUrl(dataUrl: string, name: string): void {
  const [head, b64] = dataUrl.split(',', 2);
  const mime = /data:([^;]+)/.exec(head ?? '')?.[1] ?? 'image/png';
  const bytes = decodeBase64(b64 ?? '');
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
