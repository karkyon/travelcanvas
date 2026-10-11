/**
 * BookletPrintPage - 作成した版の表示・印刷・PDF保存(SC-26 / FR-046)。
 *
 * [Gate P4] 版は作成時点の内容で固定されている。旅程がその後更新されていれば注意を出す(EX-019)。
 * 印刷・PDF保存はブラウザの印刷機能を使う(「PDFに保存」を選ぶとPDFになる)。操作ボタンは印刷されない。
 * 失効・有効期限切れの版は表示しない(410)。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import Button from '@/components/common/Button';
import Card from '@/components/common/Card';
import LoadingSpinner from '@/components/common/LoadingSpinner';
import { extractApiErrorDetailMessage, getBookletExport } from '@/services/api';
import type { BookletExportResult } from '@/services/api';
import { errorDetailMessage } from '@/utils/apiErrorDetail';
import BookletView from './booklet/BookletView';

// 422(配列)・文字列は extractApiErrorDetailMessage、構造化detail({code, message})は errorDetailMessage で表示する
function errorMessage(e: unknown, fallback: string): string {
  const detail = (e as { response?: { data?: { detail?: unknown } } })?.response?.data?.detail;
  return extractApiErrorDetailMessage(detail) ?? errorDetailMessage(e, fallback);
}

const BookletPrintPage: React.FC = () => {
  const { planId, exportId } = useParams<{ planId: string; exportId: string }>();
  const navigate = useNavigate();
  const [result, setResult] = useState<BookletExportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!planId || !exportId) return;
    (async () => {
      try {
        setResult(await getBookletExport(planId, exportId));
      } catch (e) {
        setError(errorMessage(e, 'しおりの版を表示できませんでした'));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [planId, exportId]);

  return (
    <div className="max-w-4xl mx-auto px-4 py-6">
      <div className="no-print mb-4 flex flex-wrap items-center justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={() => navigate(`/planner/${planId}/booklet`)}>← しおりの設定へ戻る</Button>
        {result && (
          <div className="flex gap-2">
            <Button variant="primary" onClick={() => window.print()}>印刷 / PDFで保存</Button>
          </div>
        )}
      </div>
      {result && (
        <p className="no-print mb-4 text-sm text-gray-700">
          「印刷 / PDFで保存」を押し、印刷先で「PDFに保存」を選ぶとPDFになります。操作ボタンは印刷されません。
          {result.export.contains_sensitive && ' 機密情報を含む版です。共有のパソコンでは印刷後に履歴やファイルを残さないでください。'}
        </p>
      )}
      {result?.booklet.is_stale && (
        <div className="no-print mb-4 p-3 rounded-lg border border-amber-300 bg-amber-50 text-amber-900 text-sm" role="status" data-testid="booklet-stale">
          この版の作成後に旅程が更新されています(作成時の旅程の版 {result.booklet.input_revision} → 現在 {result.booklet.current_revision})。
          最新の内容で印刷するには新しい版を作成してください。
        </div>
      )}
      {error && <div className="p-3 rounded-lg bg-red-50 text-red-800 text-sm" role="alert">{error}</div>}
      {isLoading ? (
        <div className="flex justify-center py-16"><LoadingSpinner size="lg" /></div>
      ) : result ? (
        <BookletView booklet={result.booklet} exportInfo={result.export} />
      ) : !error ? (
        <Card padding="lg" className="text-center text-gray-700">版が見つかりません。</Card>
      ) : null}
    </div>
  );
};

export default BookletPrintPage;
