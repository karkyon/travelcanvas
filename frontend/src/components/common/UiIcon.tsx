/**
 * [UX-6] 画面の飾りのアイコン(OS の絵文字に頼らない。移動手段の TransportIcon と同じ lucide の系統・線の太さ)。
 *
 * - 必ず文字と組にして使う。アイコンは読み上げから外す(aria-hidden)。色・形だけで意味を伝えない
 * - OS・ブラウザによって絵文字の形・色・幅が変わり、暗い見た目・系統(G11 の段階4)の色に合わなかったため置き換える
 */
import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface Props {
  icon: LucideIcon;
  size?: number;
  className?: string;
}

const UiIcon: React.FC<Props> = ({ icon: Icon, size = 16, className = '' }) => (
  <Icon aria-hidden="true" focusable="false" size={size} data-testid="ui-icon"
    className={`inline-block shrink-0 ${className}`.trim()} />
);

export default UiIcon;
