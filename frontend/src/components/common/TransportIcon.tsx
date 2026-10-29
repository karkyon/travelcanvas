/**
 * [Gate G11 段階9] 移動手段のアイコン(OS の絵文字に頼らない。既存のアイコンの系統 lucide に合わせる)。
 *
 * - 必ず名前と組にして使う(アイコンは aria-hidden。色・形だけで伝えない)。docs/ux/G11_UIUX全範囲_実装仕様.md §4
 * - ヘリは lucide に無いため、同じ線の太さ(2)・24px の格子で描いた形を使う
 * - 値が無い・知らない値はアイコンを出さない(「移動手段未設定」の文字だけ)
 */
import React from 'react';
import {
  Bike, Bus, BusFront, Car, CarTaxiFront, Footprints, Plane, Ship, Shuffle, TrainFront, TrainFrontTunnel, TramFront,
  type LucideProps,
} from 'lucide-react';
import { transportMode } from '@/utils/transportModes';

const Helicopter: React.FC<LucideProps> = ({ size = 24, className, ...rest }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} {...rest}>
    <path d="M3 4h14" />
    <path d="M10 4v3" />
    <path d="M6 10a4 3 0 0 1 4-3h4a5 4 0 0 1 5 4v1a2 2 0 0 1-2 2H9a3 2 0 0 1-3-2z" />
    <path d="M6 11H2" />
    <path d="M9 14v3" />
    <path d="M16 14v3" />
    <path d="M7 17h12" />
  </svg>
);

const ICONS: Record<string, React.FC<LucideProps>> = {
  walking: Footprints,
  bicycle: Bike,
  bus: Bus,
  express_bus: BusFront,
  train: TrainFront,
  shinkansen: TrainFrontTunnel,
  subway: TrainFrontTunnel,
  tram: TramFront,
  transit: TrainFront,
  driving: Car,
  taxi: CarTaxiFront,
  ferry: Ship,
  flight: Plane,
  helicopter: Helicopter,
  mixed: Shuffle,
};

interface Props {
  mode: string | null | undefined;
  size?: number;
  className?: string;
}

const TransportIcon: React.FC<Props> = ({ mode, size = 14, className = '' }) => {
  const key = transportMode(mode).mode;
  const Icon = key ? ICONS[key] : undefined;
  if (!key || !Icon) return null;
  return (
    <Icon aria-hidden="true" focusable="false" size={size} data-testid="transport-icon" data-mode={key}
      className={`inline-block shrink-0 align-[-2px] ${className}`.trim()} />
  );
};

export default TransportIcon;
