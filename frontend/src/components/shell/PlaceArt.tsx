/**
 * [Gate TripsWish] 場所のイメージの絵(行きたい場所のカードの上)。種類ごとの風景を、名前から決まる色合いで描く飾りの絵。
 * 写真ではない(読み上げから外す)。外の画像は読まない(相手のサイトへ見る人の情報を送らないため)。
 */
import React from 'react';

type Kind = 'sightseeing' | 'restaurant' | 'accommodation' | 'shopping' | 'other';

const PALETTES: ReadonlyArray<readonly [string, string, string, string]> = [
  // 空, 遠景, 近景, 差し色
  ['#dbeaf3', '#9fc2d6', '#5f8fa8', '#f3c98b'],
  ['#e5efe0', '#a9c6a0', '#6f9a6a', '#f2b880'],
  ['#f6e7da', '#e3b796', '#b9805e', '#f7d77c'],
  ['#ece6f4', '#bdb0d8', '#857bb1', '#f4c3a0'],
  ['#e1f0ee', '#93c8bf', '#4f9a8f', '#f5cf87'],
  ['#f4e3e6', '#dca9b3', '#ad6f7f', '#f6d38a'],
];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const Scene: React.FC<{ kind: Kind; c: readonly [string, string, string, string] }> = ({ kind, c }) => {
  const [, far, near, accent] = c;
  switch (kind) {
    case 'restaurant':
      return (
        <g>
          <ellipse cx="350" cy="196" rx="150" ry="22" fill={far} opacity=".6" />
          <path d="M215 150h270c0 52-60 82-135 82s-135-30-135-82z" fill={near} />
          <path d="M228 150h244" stroke="#fff" strokeWidth="6" strokeLinecap="round" opacity=".7" />
          <path d="M300 118c-12-20 10-30 0-52M350 112c-12-22 10-32 0-56M400 118c-12-20 10-30 0-52" fill="none" stroke={far}
            strokeWidth="7" strokeLinecap="round" />
          <path d="M520 70l-70 92M545 78l-72 90" stroke={accent} strokeWidth="8" strokeLinecap="round" />
        </g>
      );
    case 'accommodation':
      return (
        <g>
          <path d="M0 210 160 120l110 60 120-80 140 90 170-70v140H0z" fill={far} />
          <path d="M240 210V128l110-62 110 62v82z" fill={near} />
          <path d="M226 132 350 58l124 74" fill="none" stroke={accent} strokeWidth="10" strokeLinejoin="round" />
          <rect x="330" y="160" width="40" height="50" rx="6" fill="#fff" opacity=".85" />
          <rect x="270" y="140" width="34" height="28" rx="5" fill="#fff" opacity=".7" />
          <rect x="396" y="140" width="34" height="28" rx="5" fill="#fff" opacity=".7" />
        </g>
      );
    case 'shopping':
      return (
        <g>
          <path d="M0 220c120-26 230-8 350 2s220-22 350 0v38H0z" fill={far} />
          <path d="M250 104h200l-16 120H266z" fill={near} />
          <path d="M300 106c0-46 100-46 100 0" fill="none" stroke={near} strokeWidth="12" strokeLinecap="round" />
          <circle cx="350" cy="160" r="20" fill={accent} />
          <path d="M150 210l30-50 30 50zM520 210l26-42 26 42z" fill={far} opacity=".8" />
        </g>
      );
    case 'other':
      return (
        <g>
          <path d="M0 205 150 120l100 70 130-100 150 110 170-80v135H0z" fill={far} />
          <path d="M0 232c140-30 200-8 320 4s230-22 380 4v20H0z" fill={near} />
          <path d="M350 60c-34 0-58 24-58 56 0 44 58 96 58 96s58-52 58-96c0-32-24-56-58-56z" fill={accent} />
          <circle cx="350" cy="116" r="20" fill="#fff" />
        </g>
      );
    default: // sightseeing
      return (
        <g>
          <circle cx="560" cy="62" r="30" fill={accent} />
          <path d="M0 205 140 92l90 76L360 54l150 150 80-86 110 100v42H0z" fill={far} />
          <path d="M0 232 170 146l120 66 150-80 120 94 90-80 50 42v72H0z" fill={near} />
          <g stroke="#fff" strokeWidth="9" strokeLinecap="round" opacity=".85">
            <path d="M300 150h100M310 166h80M320 150v60M380 150v60" />
          </g>
        </g>
      );
  }
};

const PlaceArt: React.FC<{ kind: string; seed: string; className?: string }> = ({ kind, seed, className }) => {
  const k: Kind = (['sightseeing', 'restaurant', 'accommodation', 'shopping', 'other'] as const).includes(kind as Kind)
    ? (kind as Kind) : 'other';
  const c = PALETTES[hash(seed) % PALETTES.length]!;
  return (
    <svg viewBox="0 0 700 260" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false" className={className}
      data-kind={k}>
      <rect width="700" height="260" fill={c[0]} />
      <Scene kind={k} c={c} />
    </svg>
  );
};

export default PlaceArt;
