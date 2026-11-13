import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const media = vi.fn(async () => new Blob(['x'], { type: 'image/png' }));
const thumb = vi.fn(async () => new Blob(['y'], { type: 'image/jpeg' }));
vi.mock('@/services/api/spotIntake', () => ({ getSpotPhotoMedia: (...a: unknown[]) => media(...(a as [])) }));
vi.mock('@/services/api/g11discover', () => ({ getExternalThumb: (...a: unknown[]) => thumb(...(a as [])) }));

import SpotPhotoView from './SpotPhotoView';

describe('[Gate SpotOwnPhoto] 行きたい場所の自分の写真', () => {
  it('provider=own は場所の写真の本文を読み、出典の代わりに「自分の写真」', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:own');
    globalThis.URL.revokeObjectURL = vi.fn();
    render(<SpotPhotoView photo={{ provider: 'own', provider_id: 'a'.repeat(32) }} spotId="s1" alt="首里そば" fallback={<span>絵</span>} />);
    await waitFor(() => expect(screen.getByRole('img', { name: '首里そば' })).toHaveAttribute('src', 'blob:own'));
    expect(media).toHaveBeenCalledWith('s1');
    expect(thumb).not.toHaveBeenCalled();
    expect(screen.getByText('自分の写真')).toBeInTheDocument();
  });

  it('保存の前の写真(file)はその画像を出す', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:file');
    render(<SpotPhotoView photo={null} file={new File(['z'], 'clip.png', { type: 'image/png' })} alt="首里そば" fallback={<span>絵</span>} />);
    await waitFor(() => expect(screen.getByRole('img', { name: '首里そば' })).toHaveAttribute('src', 'blob:file'));
    expect(screen.getByText('保存すると入ります')).toBeInTheDocument();
  });
});
