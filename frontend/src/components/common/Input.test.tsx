import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Input from './Input';

describe('Input のラベルと説明の結び付け (Gate E1)', () => {
  it('label で入力欄を見つけられる(htmlFor と id が一致する)', () => {
    render(<Input label="事業者名" />);
    const input = screen.getByLabelText('事業者名');
    expect(input.tagName).toBe('INPUT');
    expect(input.id).toMatch(/^input-/);
  });

  it('id を指定すればそれを使う', () => {
    render(<Input label="名義" id="holder" />);
    expect(screen.getByLabelText('名義').id).toBe('holder');
  });

  it('エラーは aria-invalid と aria-describedby で入力欄に結び付き、読み上げられる', () => {
    render(<Input label="金額" error="数値で入力してください" />);
    const input = screen.getByLabelText('金額');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent('数値で入力してください');
    expect(screen.getByRole('alert')).toHaveTextContent('数値で入力してください');
  });

  it('補足文も aria-describedby に入り、呼び出し側の aria-describedby も残す', () => {
    render(<Input label="通貨" helperText="ISO 4217 の3文字" aria-describedby="extra" />);
    const ids = (screen.getByLabelText('通貨').getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids).toContain('extra');
    const helper = ids.find((i) => i !== 'extra');
    expect(document.getElementById(helper as string)).toHaveTextContent('ISO 4217 の3文字');
  });

  it('label が無い場合は aria-label で名前を付けられる', () => {
    render(<Input aria-label="参加者の氏名" placeholder="氏名" />);
    expect(screen.getByRole('textbox', { name: '参加者の氏名' })).toBeInTheDocument();
  });
});
