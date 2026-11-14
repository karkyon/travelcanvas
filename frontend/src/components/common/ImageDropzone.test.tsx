/** [Gate HomeLive] 画像を入れる場所: スマホでは「カメラで撮る」(後ろのカメラ)、PC では出さない。形式・大きさは理由を出す */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ImageDropzone from './ImageDropzone';

const setPointer = (coarse: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true, writable: true,
    value: (q: string) => ({ matches: coarse && q.includes('coarse'), media: q, onchange: null,
      addEventListener: () => {}, removeEventListener: () => {}, addListener: () => {}, removeListener: () => {}, dispatchEvent: () => false }),
  });
};

describe('ImageDropzone', () => {
  afterEach(() => { setPointer(false); });

  it('指で操作する端末では「カメラで撮る」を出し、後ろのカメラを使う。撮った画像は同じ流れへ渡す', () => {
    setPointer(true);
    const onFile = vi.fn();
    render(<ImageDropzone label="レシートの画像" hint="h" file={null} onFile={onFile} camera paste={false} />);
    const input = screen.getByTestId('image-dropzone-camera-input');
    expect(input).toHaveAttribute('capture', 'environment');
    expect(screen.getByText('カメラで撮る')).toBeInTheDocument();
    const f = new File(['x'], 'r.jpg', { type: 'image/jpeg' });
    fireEvent.change(input, { target: { files: [f] } });
    expect(onFile).toHaveBeenCalledWith(f);
  });

  it('PC では「カメラで撮る」を出さない(ファイルを選ぶ・ドラッグ&ドロップは残す)', () => {
    setPointer(false);
    render(<ImageDropzone label="レシートの画像" hint="h" file={null} onFile={() => {}} camera paste={false} />);
    expect(screen.queryByTestId('image-dropzone-camera')).toBeNull();
    expect(screen.getByTestId('image-dropzone-input')).toBeInTheDocument();
  });

  it('HEIC・大きすぎる画像は理由を出して受け付けない', () => {
    const onFile = vi.fn();
    render(<ImageDropzone label="レシートの画像" hint="h" file={null} onFile={onFile} paste={false} maxBytes={10} />);
    const input = screen.getByTestId('image-dropzone-input');
    fireEvent.change(input, { target: { files: [new File(['x'], 'a.heic', { type: 'image/heic' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('HEIC の画像は読めません');
    fireEvent.change(input, { target: { files: [new File(['x'.repeat(20)], 'b.png', { type: 'image/png' })] } });
    expect(screen.getByRole('alert')).toHaveTextContent('画像が大きすぎます');
    expect(onFile).not.toHaveBeenCalled();
  });
});
