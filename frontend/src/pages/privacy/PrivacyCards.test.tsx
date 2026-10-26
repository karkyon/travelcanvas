/**
 * [Gate P9] 同意の管理(ConsentsCard)とアカウントの削除(AccountDeletionCard)の画面テスト。
 *
 * - 同意は既定で全て「同意しない」。切り替えるとその目的だけを保存し、結果を案内する。失敗はエラー表示
 * - 削除: 内容を確認してから、確認の文字とパスワードが揃うまで削除ボタンを押せない。成功でonDeletedを呼ぶ。
 *   パスワード違いなどはサーバの説明を表示し、onDeletedを呼ばない。ゲストはパスワード欄を出さない
 * - [Gate G7] 猶予つきの削除: 会員は「14日後に削除する」を選べ、申し込み中は予定日と取り消しを示す
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';

const m = vi.hoisted(() => ({
  getConsents: vi.fn(), updateConsents: vi.fn(), getAccountDeletionPreview: vi.fn(), deleteAccount: vi.fn(),
}));
vi.mock('@/services/api', () => m);
const g7m = vi.hoisted(() => ({ scheduleAccountDeletion: vi.fn(), cancelAccountDeletion: vi.fn() }));
vi.mock('@/services/api/g7', async (orig) => ({ ...(await orig<typeof import('@/services/api/g7')>()), ...g7m }));
import g7fx from '@/services/api/__fixtures__/g7Responses.json';

import AccountDeletionCard from './AccountDeletionCard';
import ConsentsCard from './ConsentsCard';

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  for (const fn of Object.values(g7m)) fn.mockReset();
});

describe('ConsentsCard (Gate P9)', () => {
  it('既定は同意しない。切り替えると目的ごとに保存する', async () => {
    m.getConsents.mockResolvedValue(fx.privacy_consents_default);
    m.updateConsents.mockResolvedValue(fx.privacy_consents_updated);
    render(<ConsentsCard />);
    const list = await screen.findByRole('list', { name: '同意の一覧' });
    const boxes = within(list).getAllByRole('checkbox');
    expect(boxes).toHaveLength(4);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    // [Gate P13] 位置情報は軌跡の記録で使うため、処理の無い目的は3つ
    expect(within(list).getAllByText('現在、この目的の処理を行う機能はありません。')).toHaveLength(3);
    fireEvent.click(within(list).getByRole('checkbox', { name: /AIによる文書・候補の処理/ }));
    await waitFor(() => expect(m.updateConsents).toHaveBeenCalledWith({ ai_processing: true }));
    expect(await screen.findByRole('status')).toHaveTextContent('「AIによる文書・候補の処理」を同意するに変更しました。');
    expect(within(list).getByRole('checkbox', { name: /AIによる文書・候補の処理/ })).toBeChecked();
    expect(within(list).getByText(/最終変更:/)).toBeInTheDocument();
  });

  it('保存の失敗はエラー表示', async () => {
    m.getConsents.mockResolvedValue(fx.privacy_consents_default);
    m.updateConsents.mockRejectedValue({ response: { data: { detail: '保存できません' } } });
    render(<ConsentsCard />);
    fireEvent.click(await screen.findByRole('checkbox', { name: /位置情報の利用/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('保存できません');
    expect(screen.getByRole('checkbox', { name: /位置情報の利用/ })).not.toBeChecked();
  });
});

describe('AccountDeletionCard (Gate P9)', () => {
  it('内容を確認し、確認の文字とパスワードが揃うと削除する', async () => {
    m.getAccountDeletionPreview.mockResolvedValue(fx.account_deletion_preview);
    m.deleteAccount.mockResolvedValue(fx.account_deletion_done);
    const onDeleted = vi.fn();
    render(<AccountDeletionCard onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole('button', { name: '削除の内容を確認する' }));
    expect(await screen.findByTestId('deletion-effects')).toHaveTextContent('あなたが所有する旅行1件を削除します');
    expect(screen.getByRole('list', { name: '削除する旅行' })).toHaveTextContent('退会の契約採取(参加者1人も見られなくなります)');
    const submit = screen.getByRole('button', { name: 'アカウントを削除する' });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/確認のため/), { target: { value: '退会する' } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText('現在のパスワード'), { target: { value: 'pw' } });
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    await waitFor(() => expect(m.deleteAccount).toHaveBeenCalledWith('退会する', 'pw'));
    await waitFor(() => expect(onDeleted).toHaveBeenCalled());
  });

  it('失敗はサーバの説明を表示し、完了扱いにしない。ゲストはパスワード欄を出さない', async () => {
    m.getAccountDeletionPreview.mockResolvedValue({ ...fx.account_deletion_preview, account_type: 'guest', requires_password: false });
    m.deleteAccount.mockRejectedValue({ response: { status: 429, data: { detail: { code: 'rate_limited', message: '試行回数が多すぎます' } } } });
    const onDeleted = vi.fn();
    render(<AccountDeletionCard onDeleted={onDeleted} />);
    fireEvent.click(screen.getByRole('button', { name: '削除の内容を確認する' }));
    await screen.findByTestId('deletion-effects');
    expect(screen.queryByLabelText('現在のパスワード')).toBeNull();
    fireEvent.change(screen.getByLabelText(/確認のため/), { target: { value: '退会する' } });
    fireEvent.click(screen.getByRole('button', { name: 'アカウントを削除する' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('試行回数が多すぎます');
    expect(m.deleteAccount).toHaveBeenCalledWith('退会する', undefined);
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
    expect(screen.getByRole('button', { name: '削除の内容を確認する' })).toBeInTheDocument();
  });
});

describe('AccountDeletionCard (Gate G7 猶予つきの削除)', () => {
  it('14日後に削除を申し込み、予定日を示して取り消せる', async () => {
    const preview = { ...fx.account_deletion_preview, account_delete_grace_days: 14, can_schedule: true, scheduled: null };
    m.getAccountDeletionPreview.mockResolvedValue(preview);
    g7m.scheduleAccountDeletion.mockResolvedValue(g7fx.deletion_scheduled);
    g7m.cancelAccountDeletion.mockResolvedValue(g7fx.deletion_cancelled);
    const onDeleted = vi.fn();
    render(<AccountDeletionCard onDeleted={onDeleted} />);
    await waitFor(() => expect(m.getAccountDeletionPreview).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: '削除の内容を確認する' }));
    await screen.findByTestId('deletion-effects');
    const later = screen.getByRole('button', { name: '14日後に削除する(取り消せる)' });
    expect(later).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/確認のため/), { target: { value: '退会する' } });
    fireEvent.change(screen.getByLabelText('現在のパスワード'), { target: { value: 'pw' } });
    fireEvent.click(later);
    await waitFor(() => expect(g7m.scheduleAccountDeletion).toHaveBeenCalledWith('退会する', 'pw'));
    expect(await screen.findByTestId('deletion-scheduled')).toHaveTextContent('に削除されます');
    expect(onDeleted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '削除の申し込みを取り消す' }));
    await waitFor(() => expect(g7m.cancelAccountDeletion).toHaveBeenCalled());
    expect(await screen.findByRole('status')).toHaveTextContent('取り消しました');
    expect(screen.queryByTestId('deletion-scheduled')).toBeNull();
  });

  it('申し込み中なら開いた時に予定日を示す。ゲストには申し込みのボタンを出さない', async () => {
    m.getAccountDeletionPreview.mockResolvedValue(g7fx.deletion_preview_scheduled);
    const { unmount } = render(<AccountDeletionCard onDeleted={vi.fn()} />);
    expect(await screen.findByTestId('deletion-scheduled')).toHaveTextContent('いつも通り使えます');
    unmount();
    m.getAccountDeletionPreview.mockResolvedValue({ ...fx.account_deletion_preview, account_type: 'guest',
      requires_password: false, can_schedule: false, scheduled: null });
    render(<AccountDeletionCard onDeleted={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: '削除の内容を確認する' }));
    await screen.findByTestId('deletion-effects');
    expect(screen.queryByRole('button', { name: /日後に削除する/ })).toBeNull();
  });
});
