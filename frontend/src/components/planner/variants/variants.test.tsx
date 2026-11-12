/** [Gate PlanB] 日ごとの案: 並び・要約・検証の見出し分け、タブと控えの案の帯 */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { VariantSummary } from '@/services/api/dayVariants';
import VariantBar from './VariantBar';
import { activeOf, conditionText, groupChecks, sortVariants } from './variantModel';

const v = (o: Partial<VariantSummary>): VariantSummary => ({
  day_id: 'd', local_date: '2026-11-29', label: 'A', name: '今の案', status: 'active', reason: null, reason_label: null,
  conditions: {}, group_id: null, copied_from_day_id: null, events: 3, first_time: '09:00', last_time: '18:00', titles: [], ...o,
});
const A = v({ day_id: 'a' });
const B = v({ day_id: 'b', label: 'B', name: '雨の日', status: 'standby', reason: 'rain', reason_label: '雨',
  conditions: { transport_mode: 'train', party_size: 4, prefer_indoor: true } });
const C = v({ day_id: 'c', label: 'C', name: '古い案', status: 'archived' });

describe('variantModel', () => {
  it('A→E の順で、しまった案は後ろ', () => {
    expect(sortVariants([C, B, A]).map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(activeOf([B, A])?.day_id).toBe('a');
  });
  it('条件の要約', () => {
    expect(conditionText(B)).toEqual(['理由: 雨', '移動の既定: 電車・徒歩', '4人', '屋内を優先']);
  });
  it('検証の結果を見出しに分けて重い順', () => {
    const g = groupChecks([
      { kind: 'next', level: 'ok', title: '翌日', text: '' }, { kind: 'prev', level: 'bad', title: '前日', text: '' },
      { kind: 'drop', level: 'warn', title: '予約', text: '' },
    ]);
    expect(g.map((x) => x.title)).toEqual(['前後のつながり', '予約']);
    expect(g[0]!.items[0]!.level).toBe('bad');
  });
});

describe('VariantBar', () => {
  const handlers = () => ({ onOpen: vi.fn(), onCreate: vi.fn(), onSwitch: vi.fn(), onCompare: vi.fn(), onCheck: vi.fn(),
    onRename: vi.fn(), onArchive: vi.fn(), onDelete: vi.fn() });
  it('案が 1 つで編集できない時は出さない', () => {
    const { container } = render(<VariantBar variants={[A]} openId={null} canEdit={false} {...handlers()} />);
    expect(container.firstChild).toBeNull();
  });
  it('タブで控えの案を開き、帯から切り替える', () => {
    const h = handlers();
    const { rerender } = render(<VariantBar variants={[A, B]} openId={null} canEdit {...h} />);
    expect(screen.queryByTestId('variant-banner')).toBeNull();
    fireEvent.click(screen.getByTestId('variant-tab-B'));
    expect(h.onOpen).toHaveBeenCalledWith('b');
    rerender(<VariantBar variants={[A, B]} openId="b" canEdit checkSummary={{ ok: 2, warn: 1, bad: 0 }} {...h} />);
    expect(screen.getByTestId('variant-banner').textContent).toContain('雨の日');
    expect(screen.getByTestId('variant-tab-B').getAttribute('aria-selected')).toBe('true');
    fireEvent.click(screen.getByTestId('variant-switch'));
    expect(h.onSwitch).toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('variant-tab-A'));
    expect(h.onOpen).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByTestId('variant-create'));
    expect(h.onCreate).toHaveBeenCalled();
  });
});
