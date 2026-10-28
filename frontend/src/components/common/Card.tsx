import React from 'react';

type CardVariant = 'default' | 'outlined' | 'elevated' | 'gradient';
type CardPadding = 'none' | 'sm' | 'md' | 'lg' | 'xl';

interface CardProps {
  variant?: CardVariant;
  padding?: CardPadding;
  className?: string;
  children: React.ReactNode;
  onClick?: () => void;
  hover?: boolean;
  fullHeight?: boolean;
}

interface CardHeaderProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}

interface CardBodyProps {
  className?: string;
  children: React.ReactNode;
}

interface CardFooterProps {
  className?: string;
  children: React.ReactNode;
}

const Card: React.FC<CardProps> & {
  Header: React.FC<CardHeaderProps>;
  Body: React.FC<CardBodyProps>;
  Footer: React.FC<CardFooterProps>;
} = ({
  variant = 'default',
  padding = 'md',
  className = '',
  children,
  onClick,
  hover = false,
  fullHeight = false
}) => {
  const baseClasses = [
    // [Gate G10-UX] UX-6 面はデザインの決まり(tokens の solid の面・枠・影)へ置き換えた。暗い見た目でも同じ部品で読める
    'bg-cloud-0 text-ink-900 rounded-xl border transition-shadow duration-200',
    onClick ? 'cursor-pointer' : '',
    hover || onClick ? 'hover:shadow-md' : '',
    fullHeight ? 'h-full' : ''
  ];

  const variantClasses = {
    default: 'border-cloud-200 shadow-xs',
    outlined: 'border-cloud-200 shadow-none',
    elevated: 'border-cloud-100 shadow-md',
    gradient: 'border-none bg-accent-soft shadow-sm'
  };

  const paddingClasses = {
    none: '',
    sm: 'p-3',
    md: 'p-4',
    lg: 'p-6',
    xl: 'p-8'
  };

  const classes = [
    ...baseClasses,
    variantClasses[variant],
    paddingClasses[padding],
    className
  ].filter(Boolean).join(' ');

  return (
    <div className={classes} onClick={onClick}>
      {children}
    </div>
  );
};

// Card Header Component
const CardHeader: React.FC<CardHeaderProps> = ({
  title,
  subtitle,
  action,
  className = '',
  children
}) => {
  if (children) {
    return (
      <div className={`border-b border-cloud-200 pb-4 mb-4 ${className}`}>
        {children}
      </div>
    );
  }

  return (
    <div className={`border-b border-cloud-200 pb-4 mb-4 ${className}`}>
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          {title && (
            <h3 className="text-lg font-semibold text-ink-900 truncate">
              {title}
            </h3>
          )}
          {subtitle && (
            <p className="mt-1 text-sm text-ink-500 line-clamp-2">
              {subtitle}
            </p>
          )}
        </div>
        {action && (
          <div className="ml-4 shrink-0">
            {action}
          </div>
        )}
      </div>
    </div>
  );
};

// Card Body Component
const CardBody: React.FC<CardBodyProps> = ({
  className = '',
  children
}) => {
  return (
    <div className={className}>
      {children}
    </div>
  );
};

// Card Footer Component
const CardFooter: React.FC<CardFooterProps> = ({
  className = '',
  children
}) => {
  return (
    <div className={`border-t border-cloud-200 pt-4 mt-4 ${className}`}>
      {children}
    </div>
  );
};

// Attach sub-components
Card.Header = CardHeader;
Card.Body = CardBody;
Card.Footer = CardFooter;

export default Card;