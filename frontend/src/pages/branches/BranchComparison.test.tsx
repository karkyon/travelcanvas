/** [Gate G7] FR-019 本案と案の比較表(移動・検証・疲れ・費用・予約への影響)。 */
import { describe, it, expect } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/g7Responses.json';
import { decodeG7 } from '@/services/api/decodersG7';
import BranchComparison from './BranchComparison';

const data = decodeG7('comparison', fx.branch_comparison);

describe('BranchComparison', () => {
  it('本案と案を列に並べ、外れる予約・予算の目標・新たな問題を案ごとに出す', () => {
    render(<BranchComparison data={data} />);
    const table = screen.getByRole('table', { name: '本案と案の比較' });
    expect(within(table).getAllByRole('columnheader')).toHaveLength(2 + data.branches.length);
    expect(within(table).getByRole('row', { name: /移動\(概算\)/ })).toHaveTextContent('41分・13.7km');
    const first = screen.getByRole('group', { name: `${data.branches[0]!.title}の違い` });
    expect(first).toHaveTextContent('酒蔵見学');
    expect(first).toHaveTextContent('自動では取り消されません');
    expect(first).toHaveTextContent('届いています');
    expect(first).toHaveTextContent('食い違う変更が1件');
    expect(within(first).getByRole('list', { name: `${data.branches[0]!.title}で新たに出る問題` })).toHaveTextContent('同じ時刻');
  });

  it('費用を見せない設定では費用の行を出さない', () => {
    render(<BranchComparison data={{ ...data, costs_hidden: true }} />);
    expect(screen.queryByRole('row', { name: /費用の合計/ })).toBeNull();
    expect(screen.getByText(/費用は見せない設定/)).toBeInTheDocument();
  });
});
