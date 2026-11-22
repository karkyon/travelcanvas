/**
 * [FR-062] 「♡ 今度行きたい」のボタン(予定の詳しい所・場所の詳しい所・検索の結果)。その場所を入れておき、確認なしで保存する。
 */
import React, { useState } from 'react';
import { Heart } from 'lucide-react';
import type { WishKind, WishSource } from '@/services/api/spotIntake';
import { saveWish } from './wishSave';

interface Props {
  name: string; latitude?: number | null; longitude?: number | null; address?: string | null; genre?: string | null;
  sourceKind: WishSource; planId?: string | null; kind?: WishKind; className?: string; compact?: boolean;
}

const WishSaveButton: React.FC<Props> = ({ kind = 'next', compact, className, ...place }) => {
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const label = kind === 'again' ? 'また行きたい' : '今度行きたい';
  return (
    <button type="button" aria-pressed={state === 'saved'} disabled={state === 'busy' || !place.name.trim()}
      className={className ?? `tc-focus-ring tc-mbtn min-h-11 gap-1 ${state === 'saved' ? 'is-active' : ''}`}
      aria-label={compact ? `${place.name}を${label}に残す` : undefined}
      onClick={async () => {
        setState('busy');
        const r = await saveWish({ ...place, kind, sourceKind: place.sourceKind, planId: place.planId });
        setState(r ? 'saved' : 'idle');
      }}>
      <Heart size={16} aria-hidden="true" fill={state === 'saved' ? 'currentColor' : 'none'} />
      {!compact && <span>{state === 'saved' ? `${label}に残しました` : `♡ ${label}`}</span>}
    </button>
  );
};

export default WishSaveButton;
