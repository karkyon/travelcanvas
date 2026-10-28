import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  /** leftIcon のショートハンド */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  children: React.ReactNode;
  /** 指定すると <a> としてレンダリングする(ボタン風リンク) */
  href?: string;
}

const Button = React.forwardRef<HTMLButtonElement | HTMLAnchorElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  icon,
  fullWidth = false,
  disabled,
  className = '',
  children,
  href,
  onClick,
  ...props
}, ref) => {
  // [Gate G10-UX] UX-6 デザインの決まり(tokens)の色へ置き換えた(以前は青・灰・赤のグラデーションと強い影)。
  // 主な操作は強調色の1色だけ・状態の色は危険だけ。暗い見た目でも同じ名前の色が読める値になる(tokens.css)。
  // フォーカスの枠は決まりの色(--tc-focus)で、押せる部品と地の間に 3:1 以上の差を付ける。
  const baseClasses = [
    'inline-flex items-center justify-center',
    'font-medium rounded-lg transition-colors duration-150',
    'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-2 ring-offset-cloud-0',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'active:translate-y-px'
  ];

  const variantClasses = {
    primary: [
      'bg-accent text-on-accent shadow-sm',
      'hover:bg-accent-strong',
    ],
    secondary: [
      'bg-cloud-100 text-ink-900 border border-cloud-200',
      'hover:bg-cloud-200',
    ],
    outline: [
      'border-2 border-accent text-accent bg-transparent',
      'hover:bg-accent-soft',
    ],
    ghost: [
      'text-ink-700 hover:bg-cloud-100',
    ],
    danger: [
      'bg-danger-solid text-white shadow-sm',
      'hover:brightness-110',
    ]
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm min-h-8',
    md: 'px-4 py-2 text-base min-h-10',
    lg: 'px-6 py-3 text-lg min-h-12',
    xl: 'px-8 py-4 text-xl min-h-14'
  };

  const iconSizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6',
    xl: 'w-7 h-7'
  };

  const isDisabled = Boolean(disabled) || loading;

  const classes = [
    ...baseClasses,
    ...variantClasses[variant],
    sizeClasses[size],
    fullWidth ? 'w-full' : '',
    // href版(<a>)にはネイティブのdisabled属性が存在しないため、視覚的な
    // disabled表現をclassNameでも明示する(aria-disabledと合わせて対応)。
    href && isDisabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
    className
  ].filter(Boolean).join(' ');

  const iconClass = iconSizeClasses[size];
  const resolvedLeftIcon = leftIcon ?? icon;

  const content = (
    <>
      {loading && (
        <LoadingSpinner 
          size={size === 'sm' ? 16 : size === 'lg' ? 24 : size === 'xl' ? 28 : 20}
          className="mr-2"
        />
      )}
      
      {!loading && resolvedLeftIcon && (
        <span className={`mr-2 ${iconClass} flex items-center justify-center`}>
          {resolvedLeftIcon}
        </span>
      )}
      
      <span className={loading ? 'opacity-70' : ''}>
        {children}
      </span>
      
      {!loading && rightIcon && (
        <span className={`ml-2 ${iconClass} flex items-center justify-center`}>
          {rightIcon}
        </span>
      )}
    </>
  );

  if (href) {
    // [Gate #27] <a>要素はネイティブのdisabled属性を持たないため、これまで
    // disabled/loading状態でもクリック・キーボード操作・スクリーンリーダー
    // からは常に有効なリンクとして扱われていた(実アクセシビリティ不具合)。
    // aria-disabledに加え、クリック・キーボード操作の抑止、tabIndex制御で
    // <button>版と同等の「操作できない」状態に揃える。
    const handleAnchorClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
      if (isDisabled) {
        event.preventDefault();
        return;
      }
      (onClick as React.MouseEventHandler<HTMLAnchorElement> | undefined)?.(event);
    };

    const handleAnchorKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>) => {
      if (isDisabled && (event.key === 'Enter' || event.key === ' ')) {
        event.preventDefault();
      }
    };

    return (
      <a
        href={isDisabled ? undefined : href}
        className={classes}
        aria-disabled={isDisabled}
        tabIndex={isDisabled ? -1 : undefined}
        onClick={handleAnchorClick}
        onKeyDown={handleAnchorKeyDown}
        ref={ref as React.Ref<HTMLAnchorElement>}
        {...(props as React.AnchorHTMLAttributes<HTMLAnchorElement>)}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      className={classes}
      disabled={isDisabled}
      aria-disabled={isDisabled}
      onClick={onClick}
      ref={ref as React.Ref<HTMLButtonElement>}
      {...props}
    >
      {content}
    </button>
  );
});

Button.displayName = 'Button';

export default Button;
