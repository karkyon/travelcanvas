/** [Gate BookletPatterns] しおりの表紙。必ずタイトル・日程・エリア・人数を載せる。絵はどの場所にも合う自作の図形で、地名や写真に依存しない。 */
import React from 'react';
import type { Booklet, BookletTheme } from '@/services/api';
import { longDate } from './bookletModel';
import { THEME_WORDS } from './bookletThemes';

const Art: React.FC<{ theme: BookletTheme }> = ({ theme }) => {
  const box = { viewBox: '0 0 420 594', preserveAspectRatio: 'xMidYMid slice', className: 'bk-art', 'aria-hidden': true } as const;
  switch (theme) {
    case 'family':
      return (
        <svg {...box}>
          <circle cx="345" cy="90" r="46" fill="#ffcf3f" stroke="#1b4a66" strokeWidth="3" />
          <path d="M0 400C70 370 130 420 210 390S350 370 420 400V594H0Z" fill="#2fa8cf" stroke="#1b4a66" strokeWidth="3" />
          <path d="M0 490C90 460 180 520 260 490S380 470 420 490V594H0Z" fill="#ffe7ad" stroke="#1b4a66" strokeWidth="3" />
          <g fill="#1b4a66"><circle cx="150" cy="522" r="9" /><rect x="141" y="531" width="18" height="24" rx="8" /><circle cx="186" cy="512" r="11" /><rect x="175" y="523" width="22" height="32" rx="9" /><circle cx="226" cy="528" r="7" /><rect x="219" y="535" width="14" height="20" rx="6" /><circle cx="258" cy="514" r="11" /><rect x="247" y="525" width="22" height="30" rx="9" /></g>
        </svg>
      );
    case 'wild':
      return (
        <svg {...box} fill="none" stroke="#6d8a5f">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => <path key={i} d={`M-20 ${250 + i * 38}C70 ${170 + i * 36} 140 ${215 + i * 36} 210 ${140 + i * 36}S360 ${80 + i * 36} 450 ${130 + i * 36}`} />)}
        </svg>
      );
    case 'lovers':
      return (
        <svg {...box}>
          <circle cx="210" cy="190" r="128" fill="#e98f73" />
          <path d="M82 208C130 178 170 218 210 188S290 168 338 208V238C300 300 130 310 82 238Z" fill="#2f6d7e" />
          <circle cx="272" cy="122" r="22" fill="#f6e2d8" />
        </svg>
      );
    case 'elegant':
      return (
        <svg {...box} fill="none" stroke="#c9ad6e">
          <path d="M100 262L154 194L178 224L220 154L266 228L284 206L320 262" /><path d="M220 154L208 194L222 186L234 202" /><path d="M90 262H330" />
        </svg>
      );
    case 'solo':
      return (
        <svg {...box} fill="none" stroke="#f4efe2">
          <g transform="translate(150 120)"><rect width="120" height="120" /><path d="M60 0C90 30 90 90 60 120C30 90 30 30 60 0Z" /><path d="M0 60C30 30 90 30 120 60C90 90 30 90 0 60Z" /><circle cx="60" cy="60" r="12" /></g>
        </svg>
      );
    case 'school':
      return (
        <svg {...box} fill="#fff" stroke="#111" strokeWidth="3">
          <g transform="translate(50 180)"><path d="M0 160H320" /><path d="M40 160V96H280V160" /><path d="M16 96L160 36L304 96Z" /><path d="M90 96V160M160 96V160M230 96V160" /></g>
        </svg>
      );
    case 'space':
      return (
        <svg {...box}>
          <g fill="#fff">{[[40, 60], [96, 130], [380, 80], [330, 180], [60, 290], [392, 330], [210, 40], [130, 30], [300, 24], [24, 200], [160, 240], [360, 250]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.3" />)}</g>
          <circle cx="210" cy="800" r="400" fill="#123a5a" stroke="#6fb4dc" strokeWidth="2" />
          <g transform="translate(135 110)" fill="none" stroke="#ffb547"><circle cx="75" cy="75" r="72" strokeWidth="3" /><circle cx="75" cy="75" r="56" /><ellipse cx="75" cy="75" rx="52" ry="17" stroke="#dfe6ea" transform="rotate(-18 75 75)" /><path d="M99 49l14 6-10 10z" fill="#ffb547" /></g>
        </svg>
      );
    case 'calm':
      return (
        <svg {...box}><circle cx="70" cy="74" r="28" fill="#a33a2c" /><path d="M58 88c0-8 6-8 6-16s-4-6-4-12M72 88c0-8 6-8 6-16s-4-6-4-12" fill="none" stroke="#f7f3e6" strokeWidth="2.5" /></svg>
      );
    default:
      return null;
  }
};

interface Props { cover: NonNullable<Booklet['cover']>; theme: BookletTheme }

const BookletCover: React.FC<Props> = ({ cover, theme }) => {
  const words = THEME_WORDS[theme];
  const range = cover.end_date && cover.end_date !== cover.start_date
    ? `${longDate(cover.start_date)} 〜 ${longDate(cover.end_date)}` : longDate(cover.start_date);
  const size = cover.title.length > 26 ? 'bk-title--xl' : cover.title.length > 12 ? 'bk-title--long' : '';
  return (
    <header className="bk-cover">
      <Art theme={theme} />
      <div className="bk-cover-in">
        {words.kicker && <p className="bk-kicker">{words.kicker}</p>}
        <h1 className={`bk-title ${size}`}>{cover.title}</h1>
        <div className="bk-cover-meta">
          {cover.destination && <p className="bk-dest">{cover.destination}</p>}
          <p className="bk-dates">{range}</p>
          <p className="bk-count">{cover.day_count}日間 ・ {cover.member_count}人</p>
        </div>
        {theme === 'school' && (
          <div className="bk-namebox"><span>___ 組</span><span>___ 班</span><span>___ 番</span><span className="bk-namebox-wide">名前 ____________________</span></div>
        )}
      </div>
    </header>
  );
};

export default BookletCover;
