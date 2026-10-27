/**
 * [Gate G9] UX-1 面(surface)の部品。glass / solid / quiet / critical の4つ(src/styles/tokens.css の .tc-surface--*)。
 *
 * - glass: 見出しの帯・旅行の切り替え・NOW/NEXT・浮かぶ操作だけ(背景の写真・模様の上)。フォーム・表・警告には使わない
 * - solid: フォーム・表・チケット・長文(既定)
 * - quiet: 補足のまとまり
 * - critical: 警告・止めるべき問題(文字とアイコンも必ず付ける。色だけで伝えない)
 * 透明・ぼかしを使えない環境では、CSS が自動で不透明の面に落とす。
 */
import React from 'react';
import type { SurfaceVariant } from '@/styles/tokens';

type Padding = 'none' | 'sm' | 'md' | 'lg';
const PADDING: Record<Padding, string> = { none: '', sm: 'p-2', md: 'p-4', lg: 'p-6' };

export interface SurfaceProps extends React.HTMLAttributes<HTMLElement> {
  variant?: SurfaceVariant;
  padding?: Padding;
  as?: 'div' | 'section' | 'aside' | 'article' | 'header' | 'nav';
}

const Surface: React.FC<SurfaceProps> = ({ variant = 'solid', padding = 'md', as = 'div', className = '', children, ...rest }) => {
  const Tag = as;
  return (
    <Tag className={`tc-surface tc-surface--${variant} ${PADDING[padding]} ${className}`.trim()} data-surface={variant} {...rest}>
      {children}
    </Tag>
  );
};

export default Surface;
