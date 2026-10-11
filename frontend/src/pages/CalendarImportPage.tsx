/**
 * CalendarImportPage - カレンダー(ICS)の取込(SC-27 / FR-036「外部更新の取込は差分確認後に適用する」)。
 *
 * [Gate P8] backend/app/api/v1/calendar_import.py の画面。
 *   1. ICSファイルを選ぶと、本案と照らした取り込み案(追加・変更の前後・取り込まない理由)を表示する(本案は変えない)
 *   2. 取り込む予定を選んで「取り込む」と、1つの変更として本案へ反映する(プラン画面の「元に戻す」で取り消せる)
 * TravelCanvasから書き出したICSを他のカレンダーで編集して戻すと、同じ予定の変更として扱う。
 */
import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import { applyCalendarImport, previewCalendarImport } from '@/services/api';
import type { CalendarImportPreview } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import {
  SKIP_REASON_TEXT, describeChanges, describeWhen, selectable, toApplyItems,
} from './calendarImport/calendarImportModel';

const CalendarImportPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [file, setFile] = useState<File | null>(null);
  const [createDays, setCreateDays] = useState(false);
  const [preview, setPreview] = useState<CalendarImportPreview | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const runPreview = async (f: File | null = file, days: boolean = createDays) => {
    if (!planId || !f) return;
    setBusy('preview');
    setError(null);
    setMessage(null);
    try {
      const p = await previewCalendarImport(planId, f, days);
      setPreview(p);
      setSelected(new Set(p.candidates.filter(selectable).map((c) => c.index)));
    } catch (e) {
      setPreview(null);
      setError(errorDetailMessage(e, 'ファイルを読み込めませんでした'));
    } finally {
      setBusy(null);
    }
  };

  const apply = async () => {
    if (!planId || !preview) return;
    const items = toApplyItems(preview.candidates, selected);
    if (items.length === 0) return setError('取り込む予定を選んでください');
    setBusy('apply');
    setError(null);
    try {
      const r = await applyCalendarImport(planId, items, preview.create_missing_days, preview.plan_revision);
      setPreview(null);
      setFile(null);
      setMessage(`取り込みました(追加${r.created}件・変更${r.updated}件${r.created_days ? `・日程の追加${r.created_days}日` : ''})。` +
        'プラン画面の「元に戻す」で取り消せます。');
    } catch (e) {
      setError(errorDetailMessage(e, '取り込みに失敗しました。プランが他で更新された場合は、ファイルを選び直してください'));
    } finally {
      setBusy(null);
    }
  };

  if (!planId) return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/exports`)} className="mb-2">← 書き出しへ戻る</Button>
      <h1 className="text-2xl font-bold text-gray-900">カレンダーから取り込む</h1>
      <p className="text-sm text-gray-700 mt-1">
        Google・Apple・Outlookなどから書き出したICSファイルの予定を、内容を確認してから取り込みます。
        予定名・日時・場所だけを取り込み、説明欄は取り込みません。
      </p>

      <div aria-live="polite">
        {message && <div className="mt-4 p-3 rounded-lg bg-green-50 text-green-900 text-sm" data-testid="import-result">{message}</div>}
      </div>
      {error && <div className="mt-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      <Card padding="md" className="mt-6">
        <label htmlFor="ics-file" className="block text-sm font-medium text-gray-800">ICSファイル(1MB・500件まで)</label>
        <input id="ics-file" type="file" accept=".ics,text/calendar" className="mt-1 text-sm"
          onChange={(e) => { const f = e.target.files?.[0] ?? null; setFile(f); void runPreview(f); }} />
        <label className="flex items-center gap-2 text-sm mt-3">
          <input type="checkbox" checked={createDays} disabled={!file}
            onChange={(e) => { setCreateDays(e.target.checked); void runPreview(file, e.target.checked); }} />
          日程が無い日の予定は、日程を追加して取り込む
        </label>
        {busy === 'preview' && <p className="text-sm text-gray-700 mt-2">読み込んでいます…</p>}
      </Card>

      {preview && (
        <Card padding="md" className="mt-4">
          <section aria-labelledby="import-preview-heading">
            <h2 id="import-preview-heading" className="font-semibold text-gray-900">取り込み内容の確認</h2>
            <p className="text-sm text-gray-700 mt-1" data-testid="import-summary">
              {`${preview.summary.total}件中、追加${preview.summary.create}件・変更${preview.summary.update}件・` +
                `取り込まない${preview.summary.skip}件(時刻は${preview.timezone_id}の現地時刻)`}
            </p>
            {preview.candidates.length === 0 ? <p className="text-sm text-gray-700 mt-2">予定がありません。</p> : (
              <ul className="mt-3 space-y-2" aria-label="取り込み案">
                {preview.candidates.map((c) => (
                  <li key={c.index} className={`border rounded p-2 text-sm ${c.action === 'skip' ? 'bg-gray-50' : ''}`}>
                    {selectable(c) ? (
                      <label className="flex items-start gap-2">
                        <input type="checkbox" className="mt-1" checked={selected.has(c.index)}
                          onChange={(e) => setSelected((prev) => {
                            const next = new Set(prev);
                            if (e.target.checked) next.add(c.index); else next.delete(c.index);
                            return next;
                          })} />
                        <span>
                          <span className={`text-xs px-1.5 rounded mr-1 ${c.action === 'create' ? 'bg-green-100 text-green-900' : 'bg-blue-100 text-blue-900'}`}>
                            {c.action === 'create' ? '追加' : '変更'}
                          </span>
                          <span className="font-medium">{c.title}</span>
                          <span className="block text-xs text-gray-700">
                            {describeWhen(c)}{c.address ? ` ・ ${c.address}` : ''}{!c.day_exists ? ' ・ 日程を追加します' : ''}
                          </span>
                          {c.action === 'update' && <span className="block text-xs text-gray-800">{describeChanges(c)}</span>}
                        </span>
                      </label>
                    ) : (
                      <p>
                        <span className="text-xs px-1.5 rounded mr-1 bg-gray-200 text-gray-900">取り込まない</span>
                        <span className="font-medium">{c.title}</span>
                        <span className="block text-xs text-gray-700">{describeWhen(c)} ・ {c.reason ? SKIP_REASON_TEXT[c.reason] : ''}</span>
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Button variant="primary" className="mt-3" loading={busy === 'apply'} onClick={apply}
              disabled={toApplyItems(preview.candidates, selected).length === 0}>
              選んだ予定を取り込む
            </Button>
          </section>
        </Card>
      )}
    </div>
  );
};

export default CalendarImportPage;
