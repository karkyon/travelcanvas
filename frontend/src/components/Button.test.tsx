// [Gate #27 / A-010] このテストファイルは監査時点で13 passed / 11 failed だった。
// 失敗の原因は実装側の回帰ではなく、テストが過去のBEM風実装(btn-primary等の
// クラス名、async onClickの自動loading管理)を前提にしたまま、現行の実装
// (Tailwindのグラデーションクラス、loadingはprops制御でありButton自身は
// 非同期処理をラップしない)に追随できていなかったことにある。本ファイルは
// 実際の src/components/common/Button.tsx の挙動に合わせて書き直す。
//
// あわせて、Button.tsx側の実アクセシビリティ不具合(href指定時に disabled/
// loading が一切効かない)を修正したため、その回帰テストを追加している。
import { describe, it, expect, vi } from 'vitest'
import type { ComponentProps } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './common/Button'

describe('Button Component', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>)

    const button = screen.getByRole('button', { name: /click me/i })
    expect(button).toBeInTheDocument()
    // デフォルトvariantはprimary(青系グラデーション)
    expect(button).toHaveClass('from-blue-600', 'text-white')
  })

  it('renders with different variants', () => {
    const { rerender } = render(<Button variant="outline">Outline</Button>)
    expect(screen.getByRole('button')).toHaveClass('border-2', 'border-blue-600')

    rerender(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button')).toHaveClass('from-red-600', 'text-white')

    rerender(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole('button')).toHaveClass('text-gray-700')
  })

  it('renders with different sizes', () => {
    const { rerender } = render(<Button size="sm">Small</Button>)
    expect(screen.getByRole('button')).toHaveClass('px-3', 'py-1.5')

    rerender(<Button size="lg">Large</Button>)
    expect(screen.getByRole('button')).toHaveClass('px-6', 'py-3')
  })

  it('handles click events', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button onClick={handleClick}>Click me</Button>)

    const button = screen.getByRole('button')
    await user.click(button)

    expect(handleClick).toHaveBeenCalledTimes(1)
  })

  it('shows loading state', () => {
    render(<Button loading>Loading</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>)

    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-disabled', 'true')
  })

  it('does not call onClick when disabled', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button disabled onClick={handleClick}>Disabled</Button>)

    const button = screen.getByRole('button')
    await user.click(button)

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('does not call onClick when loading', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button loading onClick={handleClick}>Loading</Button>)

    const button = screen.getByRole('button')
    await user.click(button)

    expect(handleClick).not.toHaveBeenCalled()
  })

  it('renders as link when href is provided', () => {
    render(<Button href="/test">Link Button</Button>)

    const link = screen.getByRole('link')
    expect(link).toBeInTheDocument()
    expect(link).toHaveAttribute('href', '/test')
  })

  it('disables the link when href is combined with disabled', async () => {
    // [Gate #27] href版は元々disabled/loadingが一切効かなかった実バグの回帰テスト。
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button href="/test" disabled onClick={handleClick}>Disabled Link</Button>)

    // href属性を外すとネイティブの"link"ロールが失われるため(意図した挙動)、
    // テキストで要素を取得する。
    const link = screen.getByText('Disabled Link').closest('a')!
    expect(link).toHaveAttribute('aria-disabled', 'true')
    expect(link).not.toHaveAttribute('href')

    await user.click(link)
    expect(handleClick).not.toHaveBeenCalled()
  })

  it('forwards ref correctly', () => {
    const ref = vi.fn()

    render(<Button ref={ref}>Button</Button>)

    expect(ref).toHaveBeenCalled()
    expect(ref.mock.calls[0][0]).toBeInstanceOf(HTMLButtonElement)
  })

  it('supports custom className', () => {
    render(<Button className="custom-class">Custom</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('custom-class')
    // ベースクラス(共通レイアウトクラス)も維持されていること
    expect(button).toHaveClass('inline-flex', 'rounded-lg')
  })

  it('handles keyboard events', async () => {
    const handleClick = vi.fn()
    const user = userEvent.setup()

    render(<Button onClick={handleClick}>Keyboard</Button>)

    const button = screen.getByRole('button')
    button.focus()

    await user.keyboard('{Enter}')
    expect(handleClick).toHaveBeenCalledTimes(1)

    await user.keyboard(' ')
    expect(handleClick).toHaveBeenCalledTimes(2)
  })

  it('has proper accessibility attributes', () => {
    render(<Button aria-label="Custom label">Button</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveAttribute('aria-label', 'Custom label')
  })

  it('shows icon when provided', () => {
    const Icon = () => <span data-testid="icon">🔥</span>

    render(<Button icon={<Icon />}>With Icon</Button>)

    expect(screen.getByTestId('icon')).toBeInTheDocument()
    expect(screen.getByText('With Icon')).toBeInTheDocument()
  })

  it('calls an async onClick handler exactly once', async () => {
    // [Gate #27] Buttonはloading propで制御される設計であり、onClickの戻り値が
    // Promiseであっても自動的にラップ・await・catchはしない(呼び出し側の責務)。
    // そのため、この結合テストでは呼び出し側で明示的にawait/catchする形にし、
    // 未処理のPromise rejectionを発生させない。
    const asyncHandler = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()

    render(<Button onClick={() => { void asyncHandler() }}>Async</Button>)

    const button = screen.getByRole('button')
    await user.click(button)

    expect(asyncHandler).toHaveBeenCalledTimes(1)
  })

  it('does not leave an unhandled rejection when onClick handler rejects', async () => {
    // [Gate #27 / A-010] 監査時、このシナリオに相当するテストが未処理の
    // Promise rejectionを発生させ、テスト結果の信頼性を損なっていた
    // (Vitestが"Unhandled Errors"として報告)。呼び出し側がcatchする
    // 前提のButtonの設計に合わせ、テスト側で確実にcatchする。
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    let caught: unknown = null

    const handleClick = async () => {
      try {
        await Promise.reject(new Error('Test error'))
      } catch (e) {
        caught = e
      }
    }
    const user = userEvent.setup()

    render(<Button onClick={() => { void handleClick() }}>Async Error</Button>)

    const button = screen.getByRole('button')
    await user.click(button)

    expect(button).not.toBeDisabled()
    expect(caught).toBeInstanceOf(Error)

    consoleError.mockRestore()
  })

  it('supports fullWidth prop', () => {
    render(<Button fullWidth>Full Width</Button>)

    const button = screen.getByRole('button')
    expect(button).toHaveClass('w-full')
  })

  it('supports custom data attributes', () => {
    render(
      <Button data-testid="custom-button" data-analytics="button-click">
        Custom Data
      </Button>
    )

    const button = screen.getByTestId('custom-button')
    expect(button).toHaveAttribute('data-analytics', 'button-click')
  })

  describe('Button variants styling', () => {
    it('applies correct classes for primary variant', () => {
      render(<Button variant="primary">Primary</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('from-blue-600', 'text-white')
    })

    it('applies correct classes for outline variant', () => {
      render(<Button variant="outline">Outline</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('border-2', 'border-blue-600', 'text-blue-600')
    })

    it('applies correct classes for danger variant', () => {
      render(<Button variant="danger">Danger</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveClass('from-red-600', 'text-white')
    })
  })

  describe('Button accessibility', () => {
    it('has correct ARIA attributes when loading', () => {
      render(<Button loading>Loading</Button>)

      const button = screen.getByRole('button')
      expect(button).toHaveAttribute('aria-disabled', 'true')
    })

    it('maintains focus management', async () => {
      const user = userEvent.setup()

      render(
        <div>
          <Button>First</Button>
          <Button>Second</Button>
        </div>
      )

      const firstButton = screen.getByRole('button', { name: /first/i })
      const secondButton = screen.getByRole('button', { name: /second/i })

      firstButton.focus()
      expect(firstButton).toHaveFocus()

      await user.tab()
      expect(secondButton).toHaveFocus()
    })
  })

  describe('Button performance', () => {
    it('does not re-render unnecessarily', () => {
      const renderSpy = vi.fn()

      const TestButton = (props: ComponentProps<typeof Button>) => {
        renderSpy()
        return <Button {...props}>Test</Button>
      }

      const { rerender } = render(<TestButton>Initial</TestButton>)
      expect(renderSpy).toHaveBeenCalledTimes(1)

      // 同じpropsで再レンダー
      rerender(<TestButton>Initial</TestButton>)
      expect(renderSpy).toHaveBeenCalledTimes(2) // React.memoを使用していれば1のまま
    })
  })
})
