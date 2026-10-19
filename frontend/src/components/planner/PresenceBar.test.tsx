import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PresenceBar from './PresenceBar';
import type { PresenceChange, PresenceViewer } from '@/services/api';

const viewers: PresenceViewer[] = [
  { user_id: 'a', label: 'あなた', role: 'owner', is_self: true, devices: 1, seen_at: '', editing: null },
  { user_id: 'b', label: 'hana', role: 'editor', is_self: false, devices: 1, seen_at: '',
    editing: { kind: 'event', id: 'e1', label: '清水寺' } },
];
const changes: PresenceChange[] = [{
  revision: 4, actor_label: 'hana', is_self: false, source: 'manual', undone: false, count: 1,
  items: [{ entity_type: 'travel_event', action: 'update', label: '清水寺(朝)' }], at: null,
}];

describe('PresenceBar (Gate C1 FR-020)', () => {
  it('他の人と編集中の予定、画面より新しい変更と「最新を読み込む」を示す', () => {
    const onReload = vi.fn();
    render(<PresenceBar viewers={viewers} changes={changes} remoteRevision={4} localRevision={3} offline={false}
      onReload={onReload} />);
    expect(screen.getByRole('region', { name: '一緒に見ている人' })).toHaveTextContent('hanaさん(編集者)・「清水寺」を編集中');
    expect(screen.getByRole('status')).toHaveTextContent('hanaさんが「清水寺(朝)」を更新しました');
    fireEvent.click(screen.getByRole('button', { name: '最新を読み込む' }));
    expect(onReload).toHaveBeenCalled();
  });

  it('画面が追いついていれば変更は出さない。ひとりなら何も出さない', () => {
    const { container, rerender } = render(<PresenceBar viewers={viewers} changes={changes} remoteRevision={4}
      localRevision={4} offline={false} onReload={() => undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
    rerender(<PresenceBar viewers={[viewers[0]!]} changes={[]} remoteRevision={4} localRevision={4} offline={false}
      onReload={() => undefined} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('自分の変更だけなら「変更されました」を出さない。確認できない時はその旨を出す', () => {
    render(<PresenceBar viewers={[viewers[0]!]} changes={[{ ...changes[0]!, is_self: true }]} remoteRevision={4}
      localRevision={3} offline onReload={() => undefined} />);
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByText(/ほかの人の状況を確認できません/)).toBeInTheDocument();
  });
});
