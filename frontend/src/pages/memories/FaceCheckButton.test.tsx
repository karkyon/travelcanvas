/** [Gate Remaining-5] FR-037 顔の検査(押した時だけ・結果の案内) */
import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const m = vi.hoisted(() => ({ checkFaces: vi.fn() }));
vi.mock('@/services/api/remaining5', () => m);

import FaceCheckButton from './FaceCheckButton';

describe('FaceCheckButton', () => {
  it('写真が無ければ出さない', () => {
    const { container } = render(<FaceCheckButton planId="p" photoIds={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('押すと判定の結果を出す', async () => {
    m.checkFaces.mockResolvedValue({ configured: false, results: [], source: 'Google Cloud Vision',
      message: '顔の自動の判定の提供元が未設定です。写っている人の了解を確かめてください' });
    render(<FaceCheckButton planId="p" photoIds={['a', 'b']} />);
    expect(m.checkFaces).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /写真の顔を自動で確かめる\(2枚/ }));
    expect(await screen.findByText(/提供元が未設定/)).toBeInTheDocument();
    expect(m.checkFaces).toHaveBeenCalledWith('p', ['a', 'b']);
  });
});
