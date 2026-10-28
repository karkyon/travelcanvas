/**
 * [Gate G7] FR-019 本案と分岐案(最大3つ)の比較(backend/app/services/branch_compare.py の応答)。
 *
 * 表は「項目 × (本案・案…)」。移動は直線距離による概算、費用は通貨ごと。外す予定に紐付く予約・費用は「外れる」として分け、
 * 予約は自動では取り消されないことを書く。新たに出る問題・解消する問題は案ごとに一覧にする。
 */
import React from 'react';
import type { BranchComparison as Data, CompareColumn, Money } from '@/services/api/types/g7';

const money = (xs: Money[]) => (xs.length ? xs.map((x) => `${Number(x.amount).toLocaleString('ja-JP')} ${x.currency}`).join('・') : 'なし');

function rows(data: Data): Array<{ label: string; cells: string[] }> {
  const cols: CompareColumn[] = [data.plan, ...data.branches];
  const out = [
    { label: 'エラー', cells: cols.map((c) => `${c.counts.error}件`) },
    { label: '注意', cells: cols.map((c) => `${c.counts.warning}件`) },
    { label: '検証できない', cells: cols.map((c) => `${c.counts.unverified}件`) },
    { label: '守れていない制約', cells: cols.map((c) => `${c.constraints_violated}件`) },
    { label: '移動(概算)', cells: cols.map((c) => `${c.travel.minutes}分・${c.travel.km}km`
      + (c.travel.unknown_legs ? `(位置の無い区間${c.travel.unknown_legs})` : '')) },
    { label: '疲れの目安(最も重い日)', cells: cols.map((c) => (c.max_fatigue_percent === null ? '—' : `${c.max_fatigue_percent}%`)) },
    { label: '疲れやすい日', cells: cols.map((c) => `${c.heavy_days}日`) },
  ];
  if (!data.costs_hidden) {
    out.push({ label: '費用の合計', cells: cols.map((c) => (c.costs ? money(c.costs.total) : '—')) });
    out.push({ label: '外す予定に紐付く費用', cells: ['—', ...data.branches.map((b) => (b.costs ? money(b.costs.removed) : '—'))] });
  }
  out.push({ label: '変更', cells: ['—', ...data.branches.map((b) =>
    `追加${b.summary.added}・外す${b.summary.removed}・変更${b.summary.updated}`)] });
  return out;
}

const BranchComparison: React.FC<{ data: Data }> = ({ data }) => (
  <section aria-labelledby="branch-compare-heading" className="mt-4 space-y-3">
    <h3 id="branch-compare-heading" className="font-semibold text-ink-900">本案と比べる</h3>
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label="本案と案の比較">
        <thead>
          <tr className="text-left text-ink-700">
            <th scope="col" className="font-medium">項目</th>
            <th scope="col" className="font-medium">本案</th>
            {data.branches.map((b) => <th key={b.id} scope="col" className="font-medium">{b.title}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows(data).map((r) => (
            <tr key={r.label} className="border-t border-gray-100">
              <th scope="row" className="font-normal text-ink-900">{r.label}</th>
              {r.cells.map((c, i) => <td key={i} className="text-ink-900">{c}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    {data.branches.map((b) => (
      <div key={b.id} className="text-sm space-y-1" aria-label={`${b.title}の違い`} role="group">
        <p className="font-medium text-ink-900">{b.title}</p>
        {b.conflicts > 0 && <p className="text-amber-900">{`本案と食い違う変更が${b.conflicts}件あります(採用の前に直してください)`}</p>}
        {b.budget_target?.map((t) => (
          <p key={t.currency} className={t.met ? 'text-green-800' : 'text-red-800'}>
            {`予算の目標 ${Number(t.target).toLocaleString('ja-JP')} ${t.currency} に対して ${Number(t.branch).toLocaleString('ja-JP')} ${t.currency}`
              + (t.met ? '(届いています)' : '(届いていません)')}
          </p>
        ))}
        {b.affected_reservations && b.affected_reservations.length > 0 && (
          <p className="text-amber-900">
            {`外す予定に紐付く予約: ${b.affected_reservations.map((r) => r.label).join('・')}(自動では取り消されません。取消料がかかることがあります)`}
          </p>
        )}
        {b.new_issues.length > 0 && (
          <ul className="list-disc pl-5 text-red-800" aria-label={`${b.title}で新たに出る問題`}>
            {b.new_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}{x.estimated ? '(見積もり)' : ''}</li>)}
          </ul>
        )}
        {b.resolved_issues.length > 0 && (
          <ul className="list-disc pl-5 text-green-800" aria-label={`${b.title}で解消する問題`}>
            {b.resolved_issues.map((x, i) => <li key={`${x.code}-${i}`}>{x.message}</li>)}
          </ul>
        )}
        {b.new_issues.length === 0 && b.resolved_issues.length === 0 && <p className="text-ink-700">検証の結果は本案と変わりません。</p>}
      </div>
    ))}
    <p className="text-xs text-ink-700">
      {`移動は直線距離による概算です。検証: ${data.validation_algorithm_version}`}
      {data.costs_hidden ? '・費用は見せない設定のため表示していません' : ''}
    </p>
  </section>
);

export default BranchComparison;
