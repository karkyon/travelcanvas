import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const create = vi.fn(async (input: { name: string }) => ({ id: `id-${input.name}`, name: input.name }));
const enrich = vi.fn(async () => ({ filled: ['address'], spot: {}, matched: true }));
vi.mock('@/services/api/spotIntake', () => ({
  createWishSpot: (i: { name: string }) => create(i),
  enrichWishSpot: () => enrich(),
}));

import GoogleSavedImportDialog from './GoogleSavedImportDialog';

const CSV = 'Title,Note,URL\n首里そば,昼だけ,https://maps.google.com/?q=26.2172&x=1\n赤福 本店,,\n鳥羽水族館,,\n';

describe('[Gate GoogleSavedImport] 取り込みの窓', () => {
  it('ファイルを読み、既にある場所は外し、選んだ場所を保存して位置の無い場所を自動で探す', async () => {
    const onDone = vi.fn();
    render(<GoogleSavedImportDialog isOpen onClose={() => undefined} onDone={onDone}
      spots={[{ id: 's1', name: '赤福本店', latitude: null, longitude: null } as never]} />);
    expect(screen.getByTestId('google-import-steps')).toHaveTextContent('保存済み');
    fireEvent.change(screen.getByTestId('google-import-file'), { target: { files: [new File([CSV], '行ってみたい.csv', { type: 'text/csv' })] } });
    await waitFor(() => expect(screen.getByTestId('google-import-list')).toBeInTheDocument());
    expect(screen.getByTestId('google-import-dups')).toHaveTextContent('既にある 1 件');
    expect(screen.getByTestId('google-import-run')).toHaveTextContent('2 件を行きたい場所に取り込む');
    fireEvent.change(screen.getByTestId('google-import-category'), { target: { value: 'restaurant' } });
    fireEvent.click(screen.getByTestId('google-import-run'));
    await waitFor(() => expect(screen.getByTestId('google-import-close')).toBeInTheDocument());
    expect(create).toHaveBeenCalledTimes(2);
    expect(create.mock.calls[0]![0]).toMatchObject({ name: '首里そば', category: 'restaurant', description: '昼だけ',
      urls: [{ url: 'https://maps.google.com/?q=26.2172&x=1', label: 'Google マップ' }] });
    expect(enrich).toHaveBeenCalledTimes(2);
    expect(onDone.mock.calls[0]![0]).toContain('2 件を行きたい場所に取り込みました');
  });

  it('読めないファイルはその旨を出す', async () => {
    render(<GoogleSavedImportDialog isOpen onClose={() => undefined} onDone={() => undefined} spots={[]} />);
    fireEvent.change(screen.getByTestId('google-import-file'), { target: { files: [new File(['x'], 'a.txt')] } });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('場所を読めませんでした'));
  });
});
