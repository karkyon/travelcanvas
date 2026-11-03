import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import Modal from './Modal';

describe('Modal の余白', () => {
  it('Modal.Body を使わない中身にも余白を付ける(端に貼り付かない)', () => {
    render(<Modal isOpen onClose={vi.fn()} title="写真"><p>中身</p></Modal>);
    const wrap = screen.getByTestId('modal-content');
    expect(wrap.className).toContain('p-6');
    expect(wrap).toContainElement(screen.getByText('中身'));
  });

  it('Modal.Body / Footer で組んだ中身(form で包んだ場合も)は二重に余白を付けない', () => {
    render(
      <Modal isOpen onClose={vi.fn()} title="文書">
        <form><Modal.Body><p>本文</p></Modal.Body><Modal.Footer><button type="button">保存</button></Modal.Footer></form>
      </Modal>,
    );
    expect(screen.queryByTestId('modal-content')).toBeNull();
    expect(screen.getByText('本文').parentElement?.className).toContain('p-6');
  });
});
