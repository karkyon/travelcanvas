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
  const baseClasses = [
    'inline-flex items-center justify-center',
    'font-medium rounded-lg transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-offset-2',
    'disabled:opacity-50 disabled:cursor-not-allowed',
    'transform active:scale-95'
  ];

  const variantClasses = {
    primary: [
      'bg-gradient-to-r from-blue-600 to-blue-700',
      'hover:from-blue-700 hover:to-blue-800',
      'text-white shadow-lg hover:shadow-xl',
      'focus:ring-blue-500'
    ],
    secondary: [
      'bg-gradient-to-r from-gray-600 to-gray-700',
      'hover:from-gray-700 hover:to-gray-800',
      'text-white shadow-lg hover:shadow-xl',
      'focus:ring-gray-500'
    ],
    outline: [
      'border-2 border-blue-600 text-blue-600',
      'hover:bg-blue-600 hover:text-white',
      'focus:ring-blue-500'
    ],
    ghost: [
      'text-gray-700 hover:bg-gray-100',
      'focus:ring-gray-500'
    ],
    danger: [
      'bg-gradient-to-r from-red-600 to-red-700',
      'hover:from-red-700 hover:to-red-800',
      'text-white shadow-lg hover:shadow-xl',
      'focus:ring-red-500'
    ]
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm min-h-[2rem]',
    md: 'px-4 py-2 text-base min-h-[2.5rem]',
    lg: 'px-6 py-3 text-lg min-h-[3rem]',
    xl: 'px-8 py-4 text-xl min-h-[3.5rem]'
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
