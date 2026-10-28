/**
 * [Gate G2] FR-045 同行者(参加者)向けの項目の規則(共有の画面。旅行の所有者だけに表示)。
 *
 * 役割ごと(編集者・閲覧者)の既定と、参加者1人ずつの上書きを決める。隠した項目は、その人の画面・検索・出力・
 * しおり・当日モード・同期のどこにも出ない(backend app/services/member_policy.py が正本)。
 * 予約を隠すと、チケットと予約番号の表示も自動で隠れる。
 */
import React, { useCallback, useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { extractApiErrorDetailMessage, getMemberPolicy, putMemberOverride, putMemberPolicy } from '@/services/api';
import type { MemberFieldKey, MemberPolicy } from '@/services/api';

interface Props {
  planId: string;
  /** 参加者の一覧が変わった時に読み直すための値 */
  reloadKey?: number;
}

type RoleKey = 'editor' | 'viewer';
const ROLE_LABEL: Record<RoleKey, string> = { editor: '編集者', viewer: '閲覧者' };
const btn = 'px-3 py-2 rounded-lg text-sm disabled:opacity-50';

function errorText(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  if (detail && typeof detail === 'object' && 'message' in (detail as Record<string, unknown>)) {
    const m = (detail as { message?: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return extractApiErrorDetailMessage(detail) ?? fallback;
}

function without<T>(obj: Record<string, T>, key: string): Record<string, T> {
  const out = { ...obj };
  delete out[key];
  return out;
}

/** 選んだ項目に、含まれる項目(予約 → チケット・予約番号)を足す */
function withImplied(policy: MemberPolicy, keys: MemberFieldKey[]): MemberFieldKey[] {
  const out = new Set(keys);
  for (const c of policy.catalog.categories) {
    if (out.has(c.key)) c.implies.forEach((k) => out.add(k));
  }
  return policy.catalog.categories.map((c) => c.key).filter((k) => out.has(k));
}

const MemberPolicyPanel: React.FC<Props> = ({ planId, reloadKey = 0 }) => {
  const [policy, setPolicy] = useState<MemberPolicy | null>(null);
  const [roles, setRoles] = useState<Record<RoleKey, MemberFieldKey[]>>({ editor: [], viewer: [] });
  const [editing, setEditing] = useState<Record<string, MemberFieldKey[]>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const apply = (p: MemberPolicy) => {
    setPolicy(p);
    if (p.roles) setRoles({ editor: p.roles.editor, viewer: p.roles.viewer });
  };

  const load = useCallback(async () => {
    try {
      apply(await getMemberPolicy(planId));
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, '項目の規則を読み込めませんでした') });
    }
  }, [planId]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  if (!policy || policy.role !== 'owner') return null;

  const toggle = (list: MemberFieldKey[], key: MemberFieldKey) =>
    withImplied(policy, list.includes(key) ? list.filter((k) => k !== key && !policy.catalog.categories
      .find((c) => c.key === key)?.implies.includes(k)) : [...list, key]);

  const run = async (fn: () => Promise<MemberPolicy>, ok: string) => {
    setBusy(true);
    setMessage(null);
    try {
      apply(await fn());
      setMessage({ type: 'ok', text: ok });
      return true;
    } catch (e) {
      setMessage({ type: 'error', text: errorText(e, '保存できませんでした') });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const implied = (list: MemberFieldKey[], key: MemberFieldKey) =>
    policy.catalog.categories.some((c) => list.includes(c.key) && c.implies.includes(key));

  return (
    <section className="bg-surface rounded-xl shadow-xs p-6" aria-labelledby="member-policy-heading">
      <h2 id="member-policy-heading" className="text-lg font-semibold text-ink-900 mb-1 flex items-center gap-2">
        <ShieldCheck size={20} aria-hidden="true" />
        参加者に見せない項目
      </h2>
      <p className="text-sm text-ink-700 mb-4">
        招待した人(編集者・閲覧者)に見せない項目を選びます。隠した項目は、その人の画面・検索・書き出し・しおり・
        当日モードのどこにも表示されません。所有者(あなた)には全て見えます。
      </p>

      <table className="w-full text-sm mb-3">
        <caption className="sr-only">役割ごとに見せない項目</caption>
        <thead>
          <tr className="text-left text-ink-900">
            <th scope="col" className="py-1">項目</th>
            {(Object.keys(ROLE_LABEL) as RoleKey[]).map((r) => (
              <th key={r} scope="col" className="py-1 text-center">{ROLE_LABEL[r]}に見せない</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {policy.catalog.categories.map((c) => (
            <tr key={c.key} className="border-t border-gray-100">
              <th scope="row" className="py-2 font-normal text-ink-900">
                {c.label}
                <span className="block text-xs text-ink-700">{c.description}</span>
              </th>
              {(Object.keys(ROLE_LABEL) as RoleKey[]).map((r) => (
                <td key={r} className="py-2 text-center">
                  <input type="checkbox" aria-label={`${ROLE_LABEL[r]}に「${c.label}」を見せない`}
                    checked={roles[r].includes(c.key)} disabled={busy || implied(roles[r], c.key)}
                    onChange={() => setRoles({ ...roles, [r]: toggle(roles[r], c.key) })} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <button type="button" disabled={busy} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}
        onClick={() => void run(() => putMemberPolicy(planId, roles), '役割ごとの設定を保存しました')}>
        役割ごとの設定を保存する
      </button>

      {(policy.members ?? []).length > 0 && (
        <div className="mt-6">
          <h3 className="font-semibold text-ink-900 mb-2">1人ずつの設定</h3>
          <ul className="space-y-3">
            {(policy.members ?? []).map((m) => {
              const draft = editing[m.id];
              const labels = policy.catalog.categories.filter((c) => m.effective_hidden.includes(c.key)).map((c) => c.label);
              return (
                <li key={m.id} className="border border-gray-200 rounded-lg p-3 text-sm">
                  <p className="font-medium text-ink-900">{m.email}({m.role === 'editor' ? '編集者' : '閲覧者'})</p>
                  <p className="text-ink-700">
                    {m.hidden === null ? '役割の設定に従う' : 'この人だけの設定'}・見せない項目: {labels.length ? labels.join('・') : 'なし'}
                  </p>
                  {draft ? (
                    <fieldset className="mt-2">
                      <legend className="sr-only">{m.email} に見せない項目</legend>
                      {policy.catalog.categories.map((c) => (
                        <label key={c.key} className="flex items-center gap-2 text-ink-900">
                          <input type="checkbox" checked={draft.includes(c.key)} disabled={busy || implied(draft, c.key)}
                            onChange={() => setEditing({ ...editing, [m.id]: toggle(draft, c.key) })} />
                          {c.label}
                        </label>
                      ))}
                      <div className="flex gap-2 mt-2">
                        <button type="button" disabled={busy} className={`${btn} bg-blue-700 text-white hover:bg-blue-800`}
                          onClick={() => void run(() => putMemberOverride(planId, m.id, draft), `${m.email} の設定を保存しました`)
                            .then((ok) => { if (ok) setEditing((cur) => without(cur, m.id)); })}>
                          保存する
                        </button>
                        <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900`}
                          onClick={() => setEditing((cur) => without(cur, m.id))}>
                          やめる
                        </button>
                      </div>
                    </fieldset>
                  ) : (
                    <div className="flex gap-2 mt-2">
                      <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}
                        aria-label={`${m.email} だけの設定を変える`}
                        onClick={() => setEditing({ ...editing, [m.id]: m.effective_hidden })}>
                        この人だけ変える
                      </button>
                      {m.hidden !== null && (
                        <button type="button" disabled={busy} className={`${btn} border border-gray-300 text-ink-900 hover:bg-gray-50`}
                          aria-label={`${m.email} を役割の設定に戻す`}
                          onClick={() => void run(() => putMemberOverride(planId, m.id, null), `${m.email} を役割の設定に戻しました`)}>
                          役割の設定に戻す
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      {message && (
        <p role={message.type === 'error' ? 'alert' : 'status'}
          className={`mt-3 text-sm ${message.type === 'error' ? 'text-red-800' : 'text-green-800'}`}>
          {message.text}
        </p>
      )}
    </section>
  );
};

export default MemberPolicyPanel;
