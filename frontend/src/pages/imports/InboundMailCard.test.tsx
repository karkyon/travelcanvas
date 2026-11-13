/** [Gate Remaining-3] FR-011 予約メールの転送アドレス(設定なしの案内・作る・作り直す・止める) */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ getInboundMail: vi.fn(), createInboundMail: vi.fn(), revokeInboundMail: vi.fn() }));
vi.mock('@/services/api/remaining2', () => m);

import InboundMailCard from './InboundMailCard';

const base = { configured: true, address: null, received_count: 0, last_received_at: null, created_at: null, daily_limit: 30 };

beforeEach(() => { m.getInboundMail.mockReset(); m.createInboundMail.mockReset(); m.revokeInboundMail.mockReset(); });

describe('InboundMailCard', () => {
  it('設定が無い環境は案内だけ', async () => {
    m.getInboundMail.mockResolvedValue({ ...base, configured: false });
    render(<InboundMailCard planId="p" />);
    expect(await screen.findByText(/管理者の設定が必要です/)).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('作ると宛先を出し、止められる', async () => {
    m.getInboundMail.mockResolvedValue(base);
    m.createInboundMail.mockResolvedValue({ ...base, address: 'abcdefghijklmnopqrst@in.example.com', received_count: 2,
      last_received_at: '2026-11-13T09:00:00+00:00' });
    m.revokeInboundMail.mockResolvedValue(base);
    render(<InboundMailCard planId="p" />);
    fireEvent.click(await screen.findByRole('button', { name: '転送アドレスを作る' }));
    expect(await screen.findByTestId('inbound-mail-address')).toHaveTextContent('abcdefghijklmnopqrst@in.example.com');
    expect(screen.getByText(/届いたメール 2 通/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '止める' }));
    expect(await screen.findByRole('button', { name: '転送アドレスを作る' })).toBeInTheDocument();
    expect(m.revokeInboundMail).toHaveBeenCalledWith('p');
  });
});
