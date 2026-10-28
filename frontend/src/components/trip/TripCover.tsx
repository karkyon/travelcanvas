/**
 * [Gate G9] UX-2 旅行の表紙(写真が無い時の生成グラデーション)。
 *
 * 色は旅行先(無ければ題名)と開始の季節から決まる(styles/tokens.ts の coverFor。同じ旅行は常に同じ色)。文字は白で、
 * どの色でも 4.5:1 以上(試験で確かめる)。模様は CSS だけで描き、画像を読まない(低速の回線でも崩れない)。
 *
 * [Gate G11] 表紙の写真(photo)。写真は暗い重ね(COVER_PHOTO_SCRIM)の下に置き、白い文字は真っ白の写真の上でも
 * 4.5:1 以上になる(cover.test.ts)。位置(focusX・focusY %)と拡大(zoom %)は hero・header・card の全ての大きさで同じ。
 * 写真を読めない時は onPhotoError を呼び、グラデーションの表紙のまま(画面を壊さない)。
 */
import React from 'react';
import { coverFor } from '@/styles/tokens';

type Size = 'hero' | 'header' | 'card';
const SIZE: Record<Size, string> = { hero: 'p-5 sm:p-7 min-h-[11rem]', header: 'p-4 sm:p-5', card: 'p-4 min-h-[6.5rem]' };

export interface TripCoverPhoto {
  /** 一時の URL(blob:)。外部の URL は渡さない */
  src: string;
  focusX: number;
  focusY: number;
  zoom: number;
  alt?: string;
  /** 外部の写真の出典の表示(作者・ライセンス) */
  credit?: string | null;
}

export interface TripCoverProps extends React.HTMLAttributes<HTMLElement> {
  destination?: string | null;
  tripTitle?: string | null;
  startDate?: string | null;
  size?: Size;
  as?: 'div' | 'section' | 'header' | 'article';
  photo?: TripCoverPhoto | null;
  onPhotoError?: () => void;
}

function clamp(v: number, lo: number, hi: number): number {
  return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo;
}

const TripCover: React.FC<TripCoverProps> = ({
  destination, tripTitle, startDate, size = 'card', as = 'div', className = '', style, children, photo, onPhotoError,
  ...rest
}) => {
  const c = coverFor({ destination, title: tripTitle, startDate });
  const Tag = as;
  const fx = photo ? clamp(photo.focusX, 0, 100) : 50;
  const fy = photo ? clamp(photo.focusY, 0, 100) : 50;
  const zoom = photo ? clamp(photo.zoom, 100, 300) : 100;
  return (
    <Tag
      className={`tc-cover rounded-xl ${SIZE[size]} ${className}`.trim()}
      data-cover={c.id}
      data-has-photo={photo ? 'true' : undefined}
      style={{ ['--tc-cover-from' as string]: c.from, ['--tc-cover-to' as string]: c.to, ...style }}
      {...rest}
    >
      {photo && (
        <img
          className="tc-cover-photo"
          src={photo.src}
          alt={photo.alt ?? ''}
          data-testid="trip-cover-photo"
          draggable={false}
          onError={onPhotoError}
          style={{ objectPosition: `${fx}% ${fy}%`, transform: `scale(${zoom / 100})`, transformOrigin: `${fx}% ${fy}%` }}
        />
      )}
      {children}
      {photo?.credit && (
        <span className="tc-cover-credit" data-testid="trip-cover-credit">{photo.credit}</span>
      )}
    </Tag>
  );
};

export default TripCover;
