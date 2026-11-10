/**
 * [Gate JourneyEnds] 旅程の日の最初・最後の「出発・帰着・宿」の行(予定の一覧の外に置く)。
 * [Gate JourneyMove] 出発の下・帰着の上に、出発地 → 最初の予定 / 最後の予定 → 帰着地 の移動(手段・所要時間)の行を出す。
 */
import React from 'react';
import { BedDouble, Flag, House, TriangleAlert } from 'lucide-react';
import UiIcon from '@/components/common/UiIcon';
import TransportIcon from '@/components/common/TransportIcon';
import { transportMode, transportText } from '@/utils/transportModes';
import { anchorText, type DayAnchor } from './journeyModel';

interface Props {
  anchor: DayAnchor;
  position: 'start' | 'end';
  /** 宿が未設定の時の「＋ 宿を追加」 */
  onAddLodging?: () => void;
  /** [Gate JourneyMove] 出発・帰着の移動を設定する(旅行の基本情報を開く)。無ければ設定のボタンを出さない */
  onEditMove?: () => void;
}

const ICON = { departure: House, arrival: Flag, 'lodging-from': BedDouble, 'lodging-to': BedDouble, 'lodging-missing': TriangleAlert } as const;

const MoveLine: React.FC<{ anchor: DayAnchor; onEdit?: () => void }> = ({ anchor, onEdit }) => {
  const set = Boolean(anchor.mode);
  const what = anchor.kind === 'departure' ? '出発地から最初の予定まで' : '最後の予定から帰着地まで';
  return (
    <div className={`tc-segment-row tc-anchor-move${set ? '' : ' tc-segment-row--empty'}`} data-testid={`journey-move-${anchor.kind}`}>
      <span className="sr-only">{`${what}の移動:`}</span>
      {set ? (
        <>
          <TransportIcon mode={anchor.mode ?? undefined} />
          <span>{anchor.minutes != null ? transportText(anchor.mode, anchor.minutes) : `${transportMode(anchor.mode).label} · 所要時間は未入力`}</span>
        </>
      ) : <span>{`${what}の移動手段 未設定`}</span>}
      {onEdit && (
        <button type="button" className="tc-focus-ring tc-mini-link" onClick={onEdit} data-testid={`journey-move-edit-${anchor.kind}`}>
          {set ? '変更' : '設定する'}
        </button>
      )}
    </div>
  );
};

const JourneyAnchorRow: React.FC<Props> = ({ anchor, position, onAddLodging, onEditMove }) => {
  const { label, body } = anchorText(anchor);
  const move = anchor.kind === 'departure' || anchor.kind === 'arrival';
  return (
    <>
    {move && anchor.kind === 'arrival' && <MoveLine anchor={anchor} onEdit={onEditMove} />}
    <div className="tc-anchor" data-kind={anchor.kind} data-position={position} data-testid={`day-anchor-${position}`}>
      <span className="tc-anchor-icon" aria-hidden="true"><UiIcon icon={ICON[anchor.kind]} size={15} /></span>
      <p className="tc-anchor-text"><span className="tc-anchor-label">{label}</span>{body}</p>
      {anchor.kind === 'lodging-missing' && onAddLodging && (
        <button type="button" className="tc-focus-ring tc-mini-link" onClick={onAddLodging} data-testid="day-anchor-add-lodging">＋ 宿を追加</button>
      )}
    </div>
    {move && anchor.kind === 'departure' && <MoveLine anchor={anchor} onEdit={onEditMove} />}
    </>
  );
};

export default JourneyAnchorRow;
