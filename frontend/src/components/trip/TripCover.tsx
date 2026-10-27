/**
 * [Gate G9] UX-2 旅行の表紙(写真が無い時の生成グラデーション)。
 *
 * 色は旅行先(無ければ題名)と開始の季節から決まる(styles/tokens.ts の coverFor。同じ旅行は常に同じ色)。文字は白で、
 * どの色でも 4.5:1 以上(試験で確かめる)。模様は CSS だけで描き、画像を読まない(低速の回線でも崩れない)。
 * 写真の表紙(アップロード・EXIF の除去・非公開の保存)は別の Gate。
 */
import React from 'react';
import { coverFor } from '@/styles/tokens';

type Size = 'hero' | 'header' | 'card';
const SIZE: Record<Size, string> = { hero: 'p-5 sm:p-7 min-h-[11rem]', header: 'p-4 sm:p-5', card: 'p-4 min-h-[6.5rem]' };

export interface TripCoverProps extends React.HTMLAttributes<HTMLElement> {
  destination?: string | null;
  tripTitle?: string | null;
  startDate?: string | null;
  size?: Size;
  as?: 'div' | 'section' | 'header' | 'article';
}

const TripCover: React.FC<TripCoverProps> = ({
  destination, tripTitle, startDate, size = 'card', as = 'div', className = '', style, children, ...rest
}) => {
  const c = coverFor({ destination, title: tripTitle, startDate });
  const Tag = as;
  return (
    <Tag
      className={`tc-cover rounded-xl ${SIZE[size]} ${className}`.trim()}
      data-cover={c.id}
      style={{ ['--tc-cover-from' as string]: c.from, ['--tc-cover-to' as string]: c.to, ...style }}
      {...rest}
    >
      {children}
    </Tag>
  );
};

export default TripCover;
