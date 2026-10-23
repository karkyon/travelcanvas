/** [Gate G5] ORG-01 ロゴ・席・ドメイン、BILL-02 組織の使用量の画面。 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OrgDomain } from '@/services/api/types/g5';

const g5 = vi.hoisted(() => ({
  addOrgDomain: vi.fn(), deleteOrgLogo: vi.fn(), getOrgDomains: vi.fn(), getOrgSeats: vi.fn(), getOrgUsage: vi.fn(),
  putSeatLimit: vi.fn(), revokeOrgDomain: vi.fn(), uploadOrgLogo: vi.fn(), verifyOrgDomain: vi.fn(), getOrgLogoUrl: vi.fn(),
}));
vi.mock('@/services/api/g5', () => ({ ...g5 }));

import OrgBrandingPanel from './OrgBrandingPanel';

const pending: OrgDomain = {
  id: 'd1', domain: 'travel.example.co.jp', status: 'pending', txt_name: '_travelcanvas.travel.example.co.jp',
  txt_value: 'travelcanvas-verify=abc', verified_at: null, last_checked_at: null, last_error: null, created_at: null,
};

beforeEach(() => {
  for (const fn of Object.values(g5)) fn.mockReset();
  g5.getOrgDomains.mockResolvedValue([pending]);
  g5.getOrgSeats.mockResolvedValue({ seat_limit: 3, seats_used: 2, seats_remaining: 1, events: [
    { event: 'join', seats_after: 2, created_at: '2026-10-20T00:00:00+00:00' }] });
  g5.getOrgUsage.mockResolvedValue({ subject_type: 'org', subject_id: 'o1', period: '2026-10', metrics: [
    { metric: 'distributions', label: '組織の配布', used: 900, limit: 1000, soft_limit: 800, remaining: 100, warning: true,
      exceeded: false, overridden: false, override_reason: null },
    { metric: 'upload_bytes', label: 'アップロードの量', used: 3 * 1024 ** 2, limit: 50 * 1024 ** 3, soft_limit: 1,
      remaining: 1, warning: false, exceeded: false, overridden: true, override_reason: 'r' }] });
  g5.getOrgLogoUrl.mockResolvedValue('blob:logo');
  window.confirm = vi.fn(() => true);
});

const renderPanel = (over: Partial<React.ComponentProps<typeof OrgBrandingPanel>> = {}) => {
  const onChanged = vi.fn();
  render(<OrgBrandingPanel orgId="o1" isOwner hasLogo={false} logoVersion={null} seatLimit={3} onChanged={onChanged} {...over} />);
  return onChanged;
};

describe('OrgBrandingPanel (Gate G5)', () => {
  it('ドメイン: TXT の置き場所を示し、確認・取消・登録ができる', async () => {
    const changed = renderPanel();
    const list = await screen.findByRole('list', { name: 'ドメイン' });
    expect(list).toHaveTextContent('travel.example.co.jp・確認待ち');
    expect(list).toHaveTextContent('_travelcanvas.travel.example.co.jp');
    expect(list).toHaveTextContent('travelcanvas-verify=abc');
    g5.verifyOrgDomain.mockResolvedValue({ ...pending, status: 'verified' });
    g5.getOrgDomains.mockResolvedValue([{ ...pending, status: 'failed', last_error: 'txt_not_found' }]);
    fireEvent.click(within(list).getByRole('button', { name: 'travel.example.co.jpを確認する' }));
    await waitFor(() => expect(g5.verifyOrgDomain).toHaveBeenCalledWith('o1', 'd1'));
    expect(await screen.findByText(/TXT レコードが見つかりませんでした/)).toBeInTheDocument();
    expect(changed).toHaveBeenCalled();
    g5.revokeOrgDomain.mockResolvedValue({ ...pending, status: 'revoked' });
    fireEvent.click(screen.getByRole('button', { name: 'travel.example.co.jpを取り消す' }));
    await waitFor(() => expect(g5.revokeOrgDomain).toHaveBeenCalledWith('o1', 'd1'));
    g5.addOrgDomain.mockRejectedValue({ response: { data: { detail: { code: 'invalid_domain', message: 'ドメインの形が正しくありません' } } } });
    fireEvent.change(screen.getByLabelText('ドメイン(例: example.co.jp)'), { target: { value: 'a..b' } });
    fireEvent.click(screen.getByRole('button', { name: 'ドメインを登録' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('ドメインの形が正しくありません');
  });

  it('席: 使用中と上限を示し、owner は上限を変えられる(空欄は上限なし)', async () => {
    renderPanel();
    expect(await screen.findByTestId('org-seats')).toHaveTextContent('使用中 2人・上限 3人(残り 1人)');
    expect(screen.getByRole('list', { name: '席の記録' })).toHaveTextContent('参加(その後 2人)');
    g5.putSeatLimit.mockResolvedValue({});
    const input = screen.getByLabelText('席の上限(空欄は上限なし)');
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByRole('button', { name: '席の上限を保存' })).toBeDisabled();
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: '席の上限を保存' }));
    await waitFor(() => expect(g5.putSeatLimit).toHaveBeenCalledWith('o1', null));
  });

  it('席の上限は owner でなければ変えられない。使用量は注意を示す', async () => {
    renderPanel({ isOwner: false });
    await screen.findByTestId('org-seats');
    expect(screen.queryByLabelText('席の上限(空欄は上限なし)')).not.toBeInTheDocument();
    const usage = await screen.findByRole('list', { name: '使用量' });
    expect(usage).toHaveTextContent('組織の配布900件 / 1,000件');
    expect(usage).toHaveTextContent('上限の8割を越えました。');
    expect(usage).toHaveTextContent('3.0MB / 50.0GB(個別の上限)');
  });

  it('ロゴ: 選んだ画像を保存し、あるロゴは表示して外せる', async () => {
    g5.uploadOrgLogo.mockResolvedValue({});
    g5.deleteOrgLogo.mockResolvedValue({});
    renderPanel({ hasLogo: true, logoVersion: 'abc' });
    expect(await screen.findByRole('img', { name: '組織のロゴ' })).toHaveAttribute('src', 'blob:logo');
    const save = screen.getByRole('button', { name: 'ロゴを保存' });
    expect(save).toBeDisabled();
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'logo.png', { type: 'image/png' });
    fireEvent.change(screen.getByLabelText('画像(PNG・JPEG・WebP、1MBまで)'), { target: { files: [file] } });
    fireEvent.click(save);
    await waitFor(() => expect(g5.uploadOrgLogo).toHaveBeenCalledWith('o1', file));
    fireEvent.click(screen.getByRole('button', { name: 'ロゴを外す' }));
    await waitFor(() => expect(g5.deleteOrgLogo).toHaveBeenCalledWith('o1'));
  });
});
