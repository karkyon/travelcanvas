/**
 * BookletPage - しおり・印刷(SC-25 しおりデザイン / SC-26 PDF・印刷・公開設定 / SC-36 Export Preview)。
 *
 * [Gate P4] backend/app/api/v1/booklet.py の画面。
 *   - 設定: テーマ・密度・形式・載せる章・含める機密項目(所有者だけ)・有効期限
 *   - プレビュー: 設定から作ったしおりを表示する(保存しない)
 *   - 版の作成: 版番号を付けて保存し、印刷用の画面を開く(印刷・PDF保存はブラウザの機能)
 *   - 作成した版: 一覧・表示・失効
 * 機密項目を含めると警告を出し、有効期限を必須にする(透かしは作成者名)。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import {
  createBookletExport, extractApiErrorDetailMessage, getBookletExports, getPlanMembers, previewBooklet,
  revokeBookletExport,
} from '@/services/api';
import type { Booklet, BookletExport, BookletOptions, BookletSection, PlanMember } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import BookletView from './booklet/BookletView';
import {
  DEFAULT_OPTIONS, EXPORT_STATE_LABEL, INCLUDE_OPTIONS, SECTION_OPTIONS, THEME_OPTIONS, defaultValidUntil,
  describeIncludes, formatDateTime, isSensitive, orderSections, validUntilToIso,
} from './booklet/bookletModel';

// 422(配列)・文字列は extractApiErrorDetailMessage、構造化detail({code, message})は errorDetailMessage で表示する
function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? errorDetailMessage(e, fallback);
}

const BookletPage: React.FC = () => {
  const { planId } = useParams<{ planId: string }>();
  const navigate = useNavigate();
  const [members, setMembers] = useState<PlanMember[]>([]);
  const [options, setOptions] = useState<BookletOptions>(DEFAULT_OPTIONS);
  const [validUntil, setValidUntil] = useState('');
  const [preview, setPreview] = useState<Booklet | null>(null);
  const [exportsList, setExportsList] = useState<BookletExport[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = useMemo(() => members.find((m) => m.is_me) ?? null, [members]);
  const isOwner = me?.role === 'owner';
  const canUse = me?.role === 'owner' || me?.role === 'editor';
  const sensitive = isSensitive(options.includes);

  const runPreview = useCallback(async (opts: BookletOptions) => {
    if (!planId) return;
    setIsPreviewing(true);
    try {
      const b = await previewBooklet(planId, opts);
      setPreview(b);
      setError(null);
      if (!validUntil) setValidUntil(defaultValidUntil(b.cover?.end_date));
    } catch (e) {
      setError(errorMessage(e, 'プレビューの作成に失敗しました'));
    } finally {
      setIsPreviewing(false);
    }
  }, [planId, validUntil]);

  const loadExports = useCallback(async () => {
    if (!planId) return;
    try {
      setExportsList(await getBookletExports(planId));
    } catch (e) {
      setError(errorMessage(e, '作成した版の取得に失敗しました'));
    }
  }, [planId]);

  useEffect(() => {
    if (!planId) return;
    (async () => {
      try {
        const m = await getPlanMembers(planId);
        setMembers(m);
        const role = m.find((x) => x.is_me)?.role;
        if (role === 'owner' || role === 'editor') {
          await Promise.all([runPreview(DEFAULT_OPTIONS), loadExports()]);
        }
      } catch (e) {
        setError(errorMessage(e, 'しおりの準備に失敗しました'));
      } finally {
        setIsLoading(false);
      }
    })();
    // 初回だけ読み込む(以後のプレビューは「プレビューを更新」で行う)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);

  const toggleSection = (s: BookletSection, on: boolean) =>
    setOptions((o) => ({ ...o, sections: orderSections(on ? [...o.sections, s] : o.sections.filter((x) => x !== s)) }));

  const createVersion = async () => {
    if (!planId) return;
    if (options.sections.length === 0) return setError('載せる章を1つ以上選んでください');
    let iso: string | undefined;
    if (sensitive) {
      const r = validUntilToIso(validUntil);
      if (!r.ok) return setError(r.error);
      iso = r.data;
    }
    setIsSaving(true);
    setError(null);
    try {
      const res = await createBookletExport(planId, { ...options, ...(iso ? { valid_until: iso } : {}) });
      navigate(`/planner/${planId}/booklet/${res.export.id}`);
    } catch (e) {
      setError(errorMessage(e, '版の作成に失敗しました'));
      setIsSaving(false);
    }
  };

  const revoke = async (x: BookletExport) => {
    if (!planId) return;
    if (!window.confirm(`第${x.version_no}版を失効させますか?失効した版は表示・印刷できなくなります(印刷済みの紙やPDFは回収できません)。`)) return;
    try {
      await revokeBookletExport(planId, x.id);
    } catch (e) {
      setError(errorMessage(e, '失効に失敗しました'));
    }
    await loadExports();
  };

  if (!planId) {
    return <div className="p-8 text-center text-gray-700">プランが選択されていません。</div>;
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      <div className="mb-6 no-print">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}`)} className="mb-2">← プランへ戻る</Button>
        <h1 className="text-2xl font-bold text-gray-900">しおり・印刷</h1>
        <p className="text-sm text-gray-700 mt-1">旅程からしおりを作り、印刷やPDF保存をします。同じ内容をWebでも表示できます。</p>
      </div>

      {error && <div className="mb-4 p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}

      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : !canUse ? (
        <Card padding="lg" className="text-center text-gray-700">しおりの作成は編集者以上が行えます。</Card>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[22rem_1fr]">
          <div className="space-y-4">
            <Card padding="md">
              <h2 className="font-semibold text-gray-900 mb-3">デザイン</h2>
              <fieldset>
                <legend className="text-sm font-medium text-gray-800 mb-1">テーマ</legend>
                <div className="space-y-1 text-sm">
                  {THEME_OPTIONS.map((t) => (
                    <label key={t.value} className="flex items-start gap-2">
                      <input type="radio" name="booklet-theme" className="mt-1" checked={options.theme === t.value}
                        onChange={() => setOptions((o) => ({ ...o, theme: t.value }))} />
                      <span><span className="font-medium">{t.label}</span><span className="block text-xs text-gray-700">{t.help}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3 mt-3">
                <div>
                  <label htmlFor="booklet-density" className="block text-sm font-medium text-gray-800">密度</label>
                  <select id="booklet-density" className="w-full border rounded px-2 py-1" value={options.density}
                    onChange={(e) => setOptions((o) => ({ ...o, density: e.target.value as BookletOptions['density'] }))}>
                    <option value="normal">標準</option>
                    <option value="compact">詰める</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="booklet-format" className="block text-sm font-medium text-gray-800">主な用途</label>
                  <select id="booklet-format" className="w-full border rounded px-2 py-1" value={options.format}
                    onChange={(e) => setOptions((o) => ({ ...o, format: e.target.value as BookletOptions['format'] }))}>
                    <option value="print">印刷・PDF</option>
                    <option value="web">Web表示</option>
                  </select>
                </div>
              </div>
            </Card>

            <Card padding="md">
              <fieldset>
                <legend className="font-semibold text-gray-900 mb-2">載せる章</legend>
                <div className="grid grid-cols-2 gap-1 text-sm">
                  {SECTION_OPTIONS.map((s) => (
                    <label key={s.value} className="flex items-center gap-2">
                      <input type="checkbox" checked={options.sections.includes(s.value)}
                        onChange={(e) => toggleSection(s.value, e.target.checked)} />
                      {s.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            </Card>

            <Card padding="md">
              <fieldset>
                <legend className="font-semibold text-gray-900 mb-1">機密情報(既定は含めない)</legend>
                <p className="text-xs text-gray-700 mb-2">
                  {isOwner ? 'チケット・QRコードはどの設定でも含めません。' : '機密情報を含めた出力は旅行の所有者だけが作成できます。'}
                </p>
                <div className="space-y-1 text-sm">
                  {INCLUDE_OPTIONS.map((o) => (
                    <label key={o.key} className="flex items-start gap-2">
                      <input type="checkbox" className="mt-1" disabled={!isOwner} checked={options.includes[o.key]}
                        onChange={(e) => setOptions((x) => ({ ...x, includes: { ...x.includes, [o.key]: e.target.checked } }))} />
                      <span>{o.label}<span className="block text-xs text-gray-700">{o.help}</span></span>
                    </label>
                  ))}
                </div>
              </fieldset>
              {sensitive && (
                <div className="mt-3 p-2 rounded border border-amber-300 bg-amber-50 text-amber-900 text-sm" role="note" data-testid="sensitive-warning">
                  <p>機密情報を含む版には、作成者名の透かしと有効期限を印字します。印刷物やPDFは紛失・転送に注意し、期限後は破棄してください。</p>
                  <label htmlFor="booklet-valid-until" className="block mt-2 font-medium">有効期限(90日以内)</label>
                  <input id="booklet-valid-until" type="date" className="border rounded px-2 py-1 bg-white text-gray-900" value={validUntil}
                    onChange={(e) => setValidUntil(e.target.value)} />
                </div>
              )}
            </Card>

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => runPreview(options)} loading={isPreviewing}
                disabled={options.sections.length === 0}>プレビューを更新</Button>
              <Button variant="primary" onClick={createVersion} loading={isSaving}
                disabled={options.sections.length === 0}>この内容で版を作成</Button>
            </div>

            <Card padding="md">
              <h2 className="font-semibold text-gray-900 mb-2">作成した版</h2>
              {exportsList.length === 0 ? <p className="text-sm text-gray-700">まだ版はありません。</p> : (
                <ul className="space-y-2 text-sm" aria-label="作成した版">
                  {exportsList.map((x) => (
                    <li key={x.id} className="border rounded p-2" data-testid={`booklet-export-${x.version_no}`}>
                      <p className="font-medium">
                        第{x.version_no}版 <span className="ml-1 text-xs px-1.5 rounded bg-gray-100 text-gray-800">{EXPORT_STATE_LABEL[x.state]}</span>
                        {x.is_stale && x.state === 'active' && <span className="ml-1 text-xs px-1.5 rounded bg-amber-100 text-amber-900">旅程が更新済み</span>}
                      </p>
                      <p className="text-xs text-gray-700">
                        {formatDateTime(x.created_at)} ・ {x.created_by_name}{x.is_mine ? '(自分)' : ''} ・ {describeIncludes(x.includes)}
                        {x.valid_until ? ` ・ 有効期限 ${formatDateTime(x.valid_until)}` : ''}
                      </p>
                      <div className="flex gap-1 mt-1">
                        {x.can_view && (
                          <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/booklet/${x.id}`)}>表示・印刷</Button>
                        )}
                        {x.can_revoke && <Button variant="ghost" size="sm" onClick={() => revoke(x)}>失効</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <div aria-live="polite">
            <h2 className="sr-only">プレビュー</h2>
            {preview ? <BookletView booklet={preview} exportInfo={null} /> : (
              <Card padding="lg" className="text-center text-gray-700">プレビューを作成しています…</Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default BookletPage;
