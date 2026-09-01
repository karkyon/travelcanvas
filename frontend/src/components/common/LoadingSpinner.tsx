/**
 * LoadingSpinner コンポーネント
 * 汎用的なローディング表示
 *
 * 呼び出し側で size の指定方法が
 * 'sm'|'md'|'lg' 系と 'small'|'large' 系、数値px指定が混在しているため、
 * すべてを吸収できる型にしている(呼び出し側を1件ずつ書き換えるより安全)。
 */
import React from 'react';

export type LoadingSpinnerSize = 'sm' | 'md' | 'lg' | 'small' | 'large' | number;

interface LoadingSpinnerProps {
  size?: LoadingSpinnerSize;
  className?: string;
  color?: string;
}

const SIZE_CLASS_MAP: Record<string, string> = {
  sm: 'h-4 w-4',
  small: 'h-4 w-4',
  md: 'h-8 w-8',
  lg: 'h-12 w-12',
  large: 'h-12 w-12',
};

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  className = '',
  color = 'text-blue-600',
}) => {
  if (typeof size === 'number') {
    const px = `${size}px`;
    return (
      <div
        className={`animate-spin rounded-full border-b-2 border-current ${color} ${className}`}
        style={{ width: px, height: px }}
      />
    );
  }

  const sizeClass = SIZE_CLASS_MAP[size] ?? SIZE_CLASS_MAP.md;

  return (
    <div
      className={`animate-spin rounded-full border-b-2 border-current ${sizeClass} ${color} ${className}`}
    />
  );
};

export default LoadingSpinner;
