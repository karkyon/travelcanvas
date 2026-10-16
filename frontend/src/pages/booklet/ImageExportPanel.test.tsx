/**
 * [Gate P16] ImageExportPanel(しおりの画像出力、FR-046)の画面テスト。画像の描画(canvas)は差し替える。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import fx from '@/services/api/__fixtures__/backendContractResponses.json';
import type { Booklet, BookletOptions } from '@/services/api';

const m = vi.hoisted(() => ({ previewBooklet: vi.fn(), renderCard: vi.fn(), saveDataUrl: vi.fn() }));
vi.mock('@/services/api', () => ({ previewBooklet: m.previewBooklet }));
vi.mock('@/utils/cardImage', async (orig) => ({ ...(await orig<typeof import('@/utils/cardImage')>()), renderCard: m.renderCard, saveDataUrl: m.saveDataUrl }));

import ImageExportPanel from './ImageExportPanel';
import { CanvasUnavailableError } from '@/utils/cardImage';

const booklet = fx.booklet_preview as unknown as Booklet;
const options: BookletOptions = {
  theme: 'simple', density: 'normal', format: 'print', sections: ['cover', 'schedule', 'reservations', 'contacts'],
  includes: { confirmation_numbers: true, addresses: true, phones: true, participants: true },
};

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset();
  m.previewBooklet.mockResolvedValue(booklet);
  m.renderCard.mockReturnValue(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
});

describe('ImageExportPanel (Gate P16)', () => {
  it('しおりの設定にかかわらず機密項目を含めない投影から作り、ページごとに保存できる', async () => {
    render(<ImageExportPanel planId="p1" options={options} />);
    const panel = screen.getByRole('region', { name: '画像として保存' });
    expect(panel).toHaveTextContent('含めない: 予約番号・住所・電話・参加者名・QR・チケット(しおりの設定にかかわらず)');
    fireEvent.change(within(panel).getByLabelText('形式'), { target: { value: 'square' } });
    fireEvent.click(within(panel).getByRole('button', { name: '画像を作る' }));
    await waitFor(() => expect(m.previewBooklet).toHaveBeenCalledWith('p1', {
      ...options, sections: ['cover', 'schedule'],
      includes: { confirmation_numbers: false, addresses: false, phones: false, participants: false },
    }));
    await waitFor(() => expect(m.renderCard).toHaveBeenCalledTimes(1));
    const [card, format] = m.renderCard.mock.calls[0]!;
    expect(format).toBe('square');
    expect(card.title).toBe('京都しおり');
    const list = await within(panel).findByRole('list', { name: '作った画像' });
    expect(within(list).getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['京都しおりの画像(1/2)', '京都しおりの画像(2/2)']);
    fireEvent.click(within(list).getByRole('button', { name: '画像を保存(2/2)' }));
    expect(m.saveDataUrl).toHaveBeenCalledWith('data:image/png;base64,BBBB', '京都しおり_trip_2of2.png');
    // 一度作ると1日だけを選べる
    fireEvent.change(within(panel).getByLabelText('範囲'), { target: { value: '2026-11-01' } });
    fireEvent.click(within(panel).getByRole('button', { name: '画像を作る' }));
    await waitFor(() => expect(m.renderCard).toHaveBeenCalledTimes(2));
    expect(m.renderCard.mock.calls[1]![0].subtitle).toBe('京都・2026-11-01(日) 東山');
  });

  it('古い投影は案内し、画像を作れない環境ではその旨を出す', async () => {
    m.previewBooklet.mockResolvedValue({ ...booklet, is_stale: true });
    m.renderCard.mockImplementation(() => { throw new CanvasUnavailableError('この端末・ブラウザでは画像を作れません'); });
    render(<ImageExportPanel planId="p1" options={options} />);
    fireEvent.click(screen.getByRole('button', { name: '画像を作る' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('この端末・ブラウザでは画像を作れません');
    expect(screen.getByRole('status')).toHaveTextContent('旅程がこの後に更新されています');
  });
});
