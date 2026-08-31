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
  fullWidth?: boolean;
  children: React.ReactNode;
}

const Button: React.FC<ButtonProps> = ({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon,
  rightIcon,
  fullWidth = false,
  disabled,
  className = '',
  children,
  ...props
}) => {
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

  const classes = [
    ...baseClasses,
    ...variantClasses[variant],
    sizeClasses[size],
    fullWidth ? 'w-full' : '',
    className
  ].filter(Boolean).join(' ');

  const iconClass = iconSizeClasses[size];

  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading && (
        <LoadingSpinner 
          size={size === 'sm' ? 16 : size === 'lg' ? 24 : size === 'xl' ? 28 : 20}
          className="mr-2"
        />
      )}
      
      {!loading && leftIcon && (
        <span className={`mr-2 ${iconClass} flex items-center justify-center`}>
          {leftIcon}
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
    </button>
  );
};

export default Button;