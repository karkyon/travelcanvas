import { describe, expect, it, vi } from 'vitest';
import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

describe('Modal のフォーカス([Gate PlanSpotEdit] 課題 #3-⑥)', () => {
  it('呼び手が描くたびに新しい onClose を渡しても、入力中のフォーカスを奪わない(メモに続けて入力できる)', async () => {
    vi.useFakeTimers();
    const Host: React.FC = () => {
      const [text, setText] = useState('');
      return (
        <Modal isOpen onClose={() => setText('')} title="スポットを編集">
          <textarea aria-label="メモ" value={text} onChange={(e) => setText(e.target.value)} />
        </Modal>
      );
    };
    render(<Host />);
    act(() => { vi.runAllTimers(); });
    const memo = screen.getByLabelText('メモ');
    memo.focus();
    for (const v of ['s', 'ss', 'sss']) {
      fireEvent.change(memo, { target: { value: v } });
      act(() => { vi.runAllTimers(); });
      expect(document.activeElement).toBe(memo);
    }
    expect(memo).toHaveValue('sss');
    vi.useRealTimers();
  });

  it('Esc は最新の onClose を呼ぶ', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Modal isOpen onClose={first} title="x"><p>a</p></Modal>);
    rerender(<Modal isOpen onClose={second} title="x"><p>a</p></Modal>);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('重ねて開いた時、Esc は一番上のモーダルだけを閉じる', () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const view = (open: boolean) => (
      <Modal isOpen onClose={outer} title="編集"><Modal isOpen={open} onClose={inner} title="写真"><p>a</p></Modal></Modal>
    );
    const { rerender } = render(view(false));
    rerender(view(true)); // 編集の上に、後から写真の選択を開く
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(inner).toHaveBeenCalledTimes(1);
    expect(outer).not.toHaveBeenCalled();
  });
});
