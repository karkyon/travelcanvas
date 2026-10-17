import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import QRCode from 'qrcode';
import LocalQrCode from './LocalQrCode';
import { buildQrSvgDataUrl } from './qrDataUrl';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LocalQrCode (Gate E1)', () => {
  it('QR を端末内で SVG にし、data URL で表示する(外部への通信をしない)', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const url = 'http://localhost:4173/s/SECRET-share-token-abcdef';
    render(<LocalQrCode value={url} label="共有リンクのQRコード" />);
    const img = await screen.findByRole('img', { name: '共有リンクのQRコード' });
    const src = img.getAttribute('src') ?? '';
    expect(src.startsWith('data:image/svg+xml')).toBe(true);
    expect(decodeURIComponent(src)).toContain('<svg');
    // QR の SVG にはトークンの文字列そのものは入らない(模様として符号化される)
    expect(decodeURIComponent(src)).not.toContain('SECRET-share-token');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('値が変わると作り直す', async () => {
    const { rerender } = render(<LocalQrCode value="http://localhost/s/a" />);
    const first = (await screen.findByRole('img')).getAttribute('src');
    rerender(<LocalQrCode value="http://localhost/s/b" />);
    await waitFor(() => expect(screen.getByRole('img').getAttribute('src')).not.toBe(first));
  });

  it('作れなかった場合は URL のコピーを案内する', async () => {
    vi.spyOn(QRCode, 'toString').mockRejectedValueOnce(new Error('too long') as never);
    render(<LocalQrCode value="x" />);
    expect(await screen.findByRole('status')).toHaveTextContent('QRコードを作れませんでした');
  });

  it('buildQrSvgDataUrl は SVG を URL エンコードする', () => {
    expect(buildQrSvgDataUrl('<svg a="1"/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%20a%3D%221%22%2F%3E');
  });
});
