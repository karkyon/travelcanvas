import React, { forwardRef } from 'react';

type InputVariant = 'default' | 'error' | 'success';
type InputSize = 'sm' | 'md' | 'lg';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  variant?: InputVariant;
  inputSize?: InputSize;
  label?: string;
  error?: string;
  helperText?: string;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  fullWidth?: boolean;
  containerClassName?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(({
  variant = 'default',
  inputSize = 'md',
  label,
  error,
  helperText,
  leftIcon,
  rightIcon,
  fullWidth = false,
  containerClassName = '',
  className = '',
  disabled,
  ...props
}, ref) => {
  const finalVariant = error ? 'error' : variant;

  const baseClasses = [
    'block w-full rounded-lg border transition-all duration-200',
    'focus:outline-none focus:ring-2 focus:ring-offset-1',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-gray-50'
  ];

  const variantClasses = {
    default: [
      'border-gray-300 focus:border-blue-500 focus:ring-blue-500',
      'placeholder-gray-400'
    ],
    error: [
      'border-red-500 focus:border-red-500 focus:ring-red-500',
      'placeholder-red-300 bg-red-50'
    ],
    success: [
      'border-green-500 focus:border-green-500 focus:ring-green-500',
      'placeholder-green-300 bg-green-50'
    ]
  };

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2.5 text-base',
    lg: 'px-5 py-3 text-lg'
  };

  const iconSizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const inputClasses = [
    ...baseClasses,
    ...variantClasses[finalVariant],
    sizeClasses[inputSize],
    leftIcon ? 'pl-10' : '',
    rightIcon ? 'pr-10' : '',
    className
  ].filter(Boolean).join(' ');

  const containerClasses = [
    'relative',
    fullWidth ? 'w-full' : '',
    containerClassName
  ].filter(Boolean).join(' ');

  const iconClass = iconSizeClasses[inputSize];
  const iconPositionClass = inputSize === 'sm' ? 'top-1.5' : inputSize === 'lg' ? 'top-3' : 'top-2.5';

  return (
    <div className={containerClasses}>
      {label && (
        <label className="block text-sm font-medium text-gray-700 mb-1">
          {label}
        </label>
      )}
      
      <div className="relative">
        {leftIcon && (
          <div className={`absolute left-3 ${iconPositionClass} ${iconClass} text-gray-400 pointer-events-none flex items-center justify-center`}>
            {leftIcon}
          </div>
        )}
        
        <input
          ref={ref}
          className={inputClasses}
          disabled={disabled}
          {...props}
        />
        
        {rightIcon && (
          <div className={`absolute right-3 ${iconPositionClass} ${iconClass} text-gray-400 pointer-events-none flex items-center justify-center`}>
            {rightIcon}
          </div>
        )}
      </div>
      
      {(error || helperText) && (
        <div className="mt-1">
          {error && (
            <p className="text-sm text-red-600 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          {!error && helperText && (
            <p className="text-sm text-gray-500">{helperText}</p>
          )}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;