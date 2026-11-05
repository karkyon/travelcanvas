/**
 * [Gate BookletPatterns] しおりのデザインごとの言葉と字体。載せる内容はどのデザインでも同じで、見た目と見出しの言葉だけを変える。
 * 色・枠・並べ方は booklet.css、表紙の絵は BookletCover.tsx。
 */
import type { BookletSection, BookletTheme } from '@/services/api';

export interface ThemeWords {
  kicker: string;
  overview: string;
  schedule: string;
  sections: Partial<Record<BookletSection, string>>;
  day: (no: number) => string;
  fonts: string[];
}

const KANJI = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
const kanji = (n: number): string => (n <= 9 ? KANJI[n]! : n < 20 ? `十${KANJI[n - 10]}` : `${KANJI[Math.floor(n / 10)]}十${KANJI[n % 10]}`);
const ROMAN: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
const roman = (n: number): string => {
  let out = '';
  let rest = n;
  for (const [v, s] of ROMAN) while (rest >= v) { out += s; rest -= v; }
  return out;
};
const nth = (n: number): string => `${n}日目`;
const ENG = (n: number): string => `DAY ${n}`;

export const THEME_WORDS: Record<BookletTheme, ThemeWords> = {
  simple: { kicker: '', overview: '大日程', schedule: '日別の行程表', sections: {}, day: nth, fonts: ['Zen+Kaku+Gothic+New:wght@400;700;900'] },
  functional: { kicker: 'TRAVEL PLAN', overview: '大日程', schedule: '日別の行程表', sections: { packing: '持ち物チェック' }, day: nth, fonts: ['IBM+Plex+Sans+JP:wght@400;500;700', 'IBM+Plex+Mono:wght@500'] },
  business: { kicker: 'TRAVEL BRIEF', overview: '行程の概要', schedule: '日別の行程表', sections: { reservations: '手配の一覧', costs: '経費' }, day: nth, fonts: ['Noto+Sans+JP:wght@400;500;700', 'Inter+Tight:wght@500;700'] },
  family: { kicker: 'みんなで', overview: 'おおまかな よてい', schedule: 'まいにちの よてい', sections: { map: 'ちず', reservations: 'よやく', packing: 'もちもの', contacts: 'れんらくさき', costs: 'おかね', notes: 'おやくそく' }, day: (n) => `${n}にちめ`, fonts: ['Kiwi+Maru:wght@400;500', 'Mochiy+Pop+One'] },
  friends: { kicker: 'TRIP MAGAZINE', overview: 'ざっくり予定', schedule: 'DAY BY DAY', sections: { map: 'MAP', costs: 'お金のこと', packing: '持ち物' }, day: ENG, fonts: ['Dela+Gothic+One', 'M+PLUS+1p:wght@400;700;800'] },
  wild: { kicker: 'EXPEDITION LOG', overview: '航路(大日程)', schedule: '行動計画(日別)', sections: { map: '地図と航路', packing: '装備', notes: '注意と判断' }, day: ENG, fonts: ['BIZ+UDGothic:wght@400;700', 'Oswald:wght@500;700', 'Special+Elite'] },
  lovers: { kicker: 'Bon voyage', overview: 'ふたりの旅の流れ', schedule: '一日ずつの予定', sections: { map: 'ふたりの地図', packing: '忘れないもの' }, day: nth, fonts: ['Klee+One:wght@400;600', 'Cormorant+Garamond:ital,wght@1,500'] },
  elegant: { kicker: 'A JOURNEY', overview: '旅程', schedule: '日々の行程', sections: { map: '地図', reservations: 'ご予約', packing: 'お持ち物', contacts: 'ご連絡先', costs: 'ご予算', notes: 'ご案内' }, day: roman, fonts: ['Shippori+Mincho+B1:wght@400;600', 'Bodoni+Moda:ital,wght@0,500;1,500'] },
  calm: { kicker: '旅便り', overview: '旅の流れ', schedule: '日々の予定', sections: { map: '地図', reservations: '宿と乗り物の予約', packing: '持ち物', contacts: '困った時に', notes: 'お気をつけて' }, day: (n) => `${kanji(n)}日目`, fonts: ['Zen+Old+Mincho:wght@400;700;900', 'BIZ+UDPGothic:wght@400;700'] },
  solo: { kicker: 'NOTE', overview: '旅の流れ', schedule: '一日ずつ', sections: { packing: '持ち物', notes: 'ひとりの安全メモ' }, day: ENG, fonts: ['Zen+Maru+Gothic:wght@400;500;700', 'Courier+Prime'] },
  school: { kicker: 'しおり', overview: '全行程', schedule: '日別の行程表', sections: { packing: '持ち物', notes: 'きまり・注意', contacts: '緊急連絡' }, day: (n) => `第${n}日`, fonts: ['BIZ+UDPGothic:wght@400;700', 'Yusei+Magic'] },
  space: { kicker: 'FLIGHT PLAN', overview: 'MISSION OVERVIEW / 大日程', schedule: 'FLIGHT PLAN / 日別の行程', sections: { map: 'GROUND TRACK / 地図', reservations: 'BOOKINGS / 予約', packing: 'PAYLOAD / 持ち物', contacts: 'COMMS / 連絡先', costs: 'BUDGET / 費用', notes: 'NOTES / 注意事項' }, day: (n) => `FLIGHT DAY ${n}`, fonts: ['Noto+Sans+JP:wght@400;700', 'Orbitron:wght@500;800', 'Share+Tech+Mono'] },
  cute: { kicker: '', overview: '大日程', schedule: '日別の行程表', sections: {}, day: nth, fonts: ['Zen+Maru+Gothic:wght@400;700'] },
  accessible: { kicker: '', overview: '大日程', schedule: '日別の行程表', sections: {}, day: nth, fonts: ['BIZ+UDPGothic:wght@400;700'] },
  mono: { kicker: '', overview: '大日程', schedule: '日別の行程表', sections: {}, day: nth, fonts: ['Zen+Kaku+Gothic+New:wght@400;700;900'] },
};

export const fontUrl = (theme: BookletTheme): string =>
  `https://fonts.googleapis.com/css2?${THEME_WORDS[theme].fonts.map((f) => `family=${f}`).join('&')}&display=swap`;
