/**
 * [Gate P9] アカウント削除の説明文と送信可否(FR-039)。
 */
import type { AccountDeletionPreview } from '@/services/api';

export function deletionEffects(p: AccountDeletionPreview): string[] {
  const out: string[] = [];
  const owned = p.owned_plans.length;
  out.push(owned === 0
    ? 'あなたが所有する旅行はありません。'
    : `あなたが所有する旅行${owned}件を削除します。共有リンクはすぐに使えなくなり、参加者も見られなくなります。` +
      `${p.plan_delete_grace_days}日後に予定・予約・文書の原本を含めて完全に削除します。`);
  if (p.member_plan_count > 0) {
    const d = p.deleted_in_member_plans;
    const parts = [
      d.personal_packing_items && `個人の持ち物${d.personal_packing_items}件`,
      d.private_constraints && `秘匿の条件${d.private_constraints}件`,
      d.member_budgets && `個人予算${d.member_budgets}件`,
      d.documents && `あなたがアップロードした文書${d.documents}件`,
      d.memories && `あなたの旅の記録${d.memories}件(写真・音声を含む)`,
      d.location_tracks && `あなたの位置の軌跡${d.location_tracks}件`,
    ].filter(Boolean);
    out.push(`参加している旅行${p.member_plan_count}件から抜けます。` +
      (parts.length ? `${parts.join('・')}を削除します。` : ''));
    const k = p.kept_in_member_plans;
    const kept = [k.comments && `コメント${k.comments}件`, k.expenses && `支出${k.expenses}件`, k.votes && `投票${k.votes}件`]
      .filter(Boolean);
    if (kept.length) {
      out.push(`${kept.join('・')}は同行者の記録として旅行に残り、名前は「退会済み」と表示されます。` +
        '残したくないものは、削除する前に消してください。');
    }
  }
  out.push('ログイン中のすべての端末からログアウトし、メールアドレス・パスワード・設定を削除します。同じメールアドレスで新しく登録できます。');
  return out;
}

export function canDelete(p: AccountDeletionPreview, confirmation: string, password: string): boolean {
  return confirmation.trim() === p.confirmation_text && (!p.requires_password || password.length > 0);
}

// [Gate G6] LOC-02 守る範囲
/** 入力の検査(画面で先に分かる誤りを、送る前に案内する) */
export function zoneInputProblem(label: string, lat: string, lng: string): string | null {
  if (!label.trim()) return '名前を入力してください(例: 自宅)';
  if (label.trim().length > 50) return '名前は50文字までです';
  const la = Number(lat);
  const lo = Number(lng);
  if (lat.trim() === '' || !Number.isFinite(la) || la < -90 || la > 90) return '緯度は -90〜90 の数で入力してください';
  if (lng.trim() === '' || !Number.isFinite(lo) || lo < -180 || lo > 180) return '経度は -180〜180 の数で入力してください';
  return null;
}
