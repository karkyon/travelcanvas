/** [Gate JourneyEnds] 旅程の日の最初・最後の「出発・到着・宿」の行(予定の一覧の外に置く) */
import React from 'react';
import { BedDouble, Flag, House, TriangleAlert } from 'lucide-react';
import UiIcon from '@/components/common/UiIcon';
import { anchorText, type DayAnchor } from './journeyModel';

interface Props {
  anchor: DayAnchor;
  position: 'start' | 'end';
  /** 宿が未設定の時の「＋ 宿を追加」 */
  onAddLodging?: () => void;
}

const ICON = { departure: House, arrival: Flag, 'lodging-from': BedDouble, 'lodging-to': BedDouble, 'lodging-missing': TriangleAlert } as const;

const JourneyAnchorRow: React.FC<Props> = ({ anchor, position, onAddLodging }) => {
  const { label, body } = anchorText(anchor);
  return (
    <div className="tc-anchor" data-kind={anchor.kind} data-position={position} data-testid={`day-anchor-${position}`}>
      <span className="tc-anchor-icon" aria-hidden="true"><UiIcon icon={ICON[anchor.kind]} size={15} /></span>
      <p className="tc-anchor-text"><span className="tc-anchor-label">{label}</span>{body}</p>
      {anchor.kind === 'lodging-missing' && onAddLodging && (
        <button type="button" className="tc-focus-ring tc-mini-link" onClick={onAddLodging} data-testid="day-anchor-add-lodging">＋ 宿を追加</button>
      )}
    </div>
  );
};

export default JourneyAnchorRow;
