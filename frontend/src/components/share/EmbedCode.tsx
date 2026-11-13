/**
 * [Gate Remaining-5] FR-042 共有リンクの旅程を、ほかのサイト(ブログなど)へ貼るコード。
 * 作った時だけ出す(共有の鍵を含むため。URL と同じ扱い)。見せる項目はリンクの選択どおり・読むだけ。
 */
import React, { useState } from 'react';
import { API_BASE_URL } from '@/services/api/core';
import { embedIframe, embedSnippet } from './embedModel';

const EmbedCode: React.FC<{ token: string }> = ({ token }) => {
  const [copied, setCopied] = useState<string | null>(null);
  const codes = [
    { key: 'js', label: '部品(スクリプト)で貼る', value: embedSnippet(token, API_BASE_URL) },
    { key: 'iframe', label: 'iframe で貼る', value: embedIframe(token, API_BASE_URL) },
  ];
  const copy = async (key: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(key);
    } catch {
      setCopied(null);
    }
  };
  return (
    <div className="space-y-2" data-testid="embed-code">
      <p className="text-sm font-medium text-ink-900">ほかのサイトに貼るコード</p>
      {codes.map((c) => (
        <div key={c.key}>
          <label className="text-xs text-ink-700" htmlFor={`embed-${c.key}`}>{c.label}</label>
          <div className="flex gap-2">
            <textarea id={`embed-${c.key}`} readOnly rows={2} value={c.value}
              className="flex-1 px-2 py-1 border border-gray-300 rounded-lg bg-surface text-xs font-mono" />
            <button type="button" onClick={() => void copy(c.key, c.value)}
              className="px-3 py-1 text-sm border border-blue-700 text-blue-800 rounded-lg">{copied === c.key ? '写しました' : '写す'}</button>
          </div>
        </div>
      ))}
      <p className="text-xs text-ink-700">共有をやめる(失効させる)と、貼った所でも見えなくなります。</p>
    </div>
  );
};

export default EmbedCode;
