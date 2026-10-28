import React, { forwardRef, useId } from 'react';

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
  id,
  ...props
}, ref) => {
  const finalVariant = error ? 'error' : variant;
  // [Gate E1] label を入力欄に結び付ける(以前は <label> に htmlFor が無く、読み上げで
  // 何の入力欄か分からず、axe の label 規則にも違反していた)。id 指定があればそれを使う。
  const generatedId = useId();
  const inputId = id ?? `input-${generatedId}`;
  const messageId = error || helperText ? `${inputId}-message` : undefined;
  const describedBy = [props['aria-describedby'], messageId].filter(Boolean).join(' ') || undefined;

  const baseClasses = [
    'block w-full rounded-lg border transition-all duration-200',
    'focus:outline-hidden focus:ring-2 focus:ring-offset-1',
    'disabled:opacity-50 disabled:cursor-not-allowed disabled:bg-cloud-100',
    // [Gate G10-UX] UX-6 入力の地・文字・枠・フォーカスはデザインの決まり(暗い見た目でも同じ部品で読める)
    'bg-cloud-0 text-ink-900 placeholder:text-ink-500 ring-offset-cloud-0'
  ];

  const variantClasses = {
    default: [
      'border-cloud-200 focus:border-focus focus:ring-focus',
    ],
    error: [
      'border-danger focus:border-danger focus:ring-danger',
      'bg-danger-soft'
    ],
    success: [
      'border-success focus:border-success focus:ring-success',
      'bg-success-soft'
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
        <label htmlFor={inputId} className="block text-sm font-medium text-ink-700 mb-1">
          {label}
        </label>
      )}
      
      <div className="relative">
        {leftIcon && (
          <div className={`absolute left-3 ${iconPositionClass} ${iconClass} text-ink-500 pointer-events-none flex items-center justify-center`}>
            {leftIcon}
          </div>
        )}
        
        <input
          ref={ref}
          className={inputClasses}
          disabled={disabled}
          {...props}
          id={inputId}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={describedBy}
        />
        
        {rightIcon && (
          <div className={`absolute right-3 ${iconPositionClass} ${iconClass} text-ink-500 pointer-events-none flex items-center justify-center`}>
            {rightIcon}
          </div>
        )}
      </div>
      
      {(error || helperText) && (
        <div className="mt-1" id={messageId}>
          {error && (
            <p className="text-sm text-danger flex items-center" role="alert">
              <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              {error}
            </p>
          )}
          {!error && helperText && (
            <p className="text-sm text-ink-700">{helperText}</p>
          )}
        </div>
      )}
    </div>
  );
});

Input.displayName = 'Input';

export default Input;