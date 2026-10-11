/**
 * [Gate P9] アカウント削除の説明文と送信可否(privacyModel)の単体テスト。
 */
import { describe, it, expect } from 'vitest';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { AccountDeletionPreview } from '@/services/api';
import { canDelete, deletionEffects } from './privacyModel';

const base = fx.account_deletion_preview as AccountDeletionPreview;

describe('privacyModel (Gate P9)', () => {
  it('所有する旅行は猶予日数とともに説明し、参加していなければ参加の説明はしない', () => {
    const t = deletionEffects(base);
    expect(t[0]).toBe(`あなたが所有する旅行1件を削除します。共有リンクはすぐに使えなくなり、参加者も見られなくなります。` +
      `${base.plan_delete_grace_days}日後に予定・予約・文書の原本を含めて完全に削除します。`);
    expect(t.some((x) => x.includes('参加している旅行'))).toBe(false);
    expect(t[t.length - 1]).toContain('同じメールアドレスで新しく登録できます');
    expect(deletionEffects({ ...base, owned_plans: [] })[0]).toBe('あなたが所有する旅行はありません。');
  });

  it('参加している旅行で消えるもの・残るものを件数で説明する(0件は書かない)', () => {
    const t = deletionEffects({
      ...base, member_plan_count: 2,
      deleted_in_member_plans: { personal_packing_items: 1, private_constraints: 0, member_budgets: 2, documents: 1 },
      kept_in_member_plans: { comments: 3, expenses: 0, votes: 1 },
    });
    expect(t).toContain('参加している旅行2件から抜けます。個人の持ち物1件・個人予算2件・あなたがアップロードした文書1件を削除します。');
    expect(t).toContain('コメント3件・投票1件は同行者の記録として旅行に残り、名前は「退会済み」と表示されます。残したくないものは、削除する前に消してください。');
    const none = deletionEffects({ ...base, member_plan_count: 1,
      deleted_in_member_plans: { personal_packing_items: 0, private_constraints: 0, member_budgets: 0, documents: 0 },
      kept_in_member_plans: { comments: 0, expenses: 0, votes: 0 } });
    expect(none).toContain('参加している旅行1件から抜けます。');
  });

  it('確認の文字が一致し、必要ならパスワードがある時だけ削除できる', () => {
    expect(canDelete(base, '退会する', '')).toBe(false);
    expect(canDelete(base, ' 退会する ', 'pw')).toBe(true);
    expect(canDelete(base, '退会', 'pw')).toBe(false);
    expect(canDelete({ ...base, requires_password: false }, '退会する', '')).toBe(true);
  });
});
