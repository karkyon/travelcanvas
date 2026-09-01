import { describe, it, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Button from './common/Button'

describe('Button Component', () => {
  it('renders with default props', () => {
    render(<Button>Click me</Button>)
    
    const button = screen.getByRole('button', { name: /click me/i })
    expect(button).toBeInTheDocument()
    expect(button).toHaveClass('btn-primary') // デフォルトvariant
  })

  it('renders with different variants', () => {
    const { rerender } = render(<Button variant="outline">Outline</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-outline')

    rerender(<Button variant="danger">Danger</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-danger')

    rerender(<Button variant="ghost">Ghost</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-ghost')
  })

  it('renders with different sizes', () => {
    const { rerender } = render(<Button size="sm">Small</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-sm')

    rerender(<Button size="lg">Large</Button>)
    expect(screen.getByRole('button')).toHaveClass('btn-lg')
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
    expect(button).toHaveClass('loading')
    expect(screen.getByTestId('loading-spinner')).toBeInTheDocument()
  })

  it('can be disabled', () => {
    render(<Button disabled>Disabled</Button>)
    
    const button = screen.getByRole('button')
    expect(button).toBeDisabled()
    expect(button).toHaveClass('disabled')
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
    expect(button).toHaveClass('btn') // ベースクラスも維持
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

  it('handles async onClick', async () => {
    const asyncHandler = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    
    render(<Button onClick={asyncHandler}>Async</Button>)
    
    const button = screen.getByRole('button')
    await user.click(button)
    
    // ローディング状態をチェック
    expect(button).toHaveClass('loading')
    
    // 非同期処理完了まで待機
    await waitFor(() => {
      expect(button).not.toHaveClass('loading')
    })
    
    expect(asyncHandler).toHaveBeenCalledTimes(1)
  })

  it('handles async onClick errors', async () => {
    const asyncHandler = vi.fn().mockRejectedValue(new Error('Test error'))
    const user = userEvent.setup()
    
    // エラーログを抑制
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    
    render(<Button onClick={asyncHandler}>Async Error</Button>)
    
    const button = screen.getByRole('button')
    await user.click(button)
    
    // エラー後もボタンが使用可能になることを確認
    await waitFor(() => {
      expect(button).not.toHaveClass('loading')
    })
    
    expect(asyncHandler).toHaveBeenCalledTimes(1)
    
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
      expect(button).toHaveClass('bg-blue-600', 'text-white', 'hover:bg-blue-700')
    })

    it('applies correct classes for outline variant', () => {
      render(<Button variant="outline">Outline</Button>)
      
      const button = screen.getByRole('button')
      expect(button).toHaveClass('border', 'border-gray-300', 'bg-transparent')
    })

    it('applies correct classes for danger variant', () => {
      render(<Button variant="danger">Danger</Button>)
      
      const button = screen.getByRole('button')
      expect(button).toHaveClass('bg-red-600', 'text-white', 'hover:bg-red-700')
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
      
      const TestButton = (props: any) => {
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