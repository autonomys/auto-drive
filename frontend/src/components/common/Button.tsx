import React, { MouseEventHandler, ReactNode } from 'react';

type ButtonVariant =
  | 'primary'
  | 'accent'
  | 'outline'
  | 'grayscale'
  | 'danger'
  | 'lightAccent'
  | 'lightDanger'
  | 'primaryOutline';

export interface ButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}

const baseClasses =
  'px-4 py-2 rounded-lg shadow-sm focus:outline-none transition-colors duration-200';

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: `${baseClasses} bg-primary text-white hover:bg-primaryHover dark:bg-darkPrimary dark:hover:bg-darkPrimaryHover disabled:opacity-50 disabled:hover:opacity-50 disabled:hover:cursor-default dark:bg-backgroundDark`,
  accent: `${baseClasses} bg-accent dark:bg-darkAccent text-white opacity-100 hover:opacity-80 disabled:opacity-50 disabled:hover disabled:hover:cursor-default dark:bg-backgroundDark`,
  outline: `${baseClasses} bg-transparent text-accent hover:text-accent-dark border border-accent hover:border-accent-dark disabled:opacity-50 disabled:hover disabled:hover:cursor-default dark:bg-backgroundDark`,
  lightAccent: `${baseClasses} font-medium bg-blue-100 text-blue-900 hover:bg-blue-200 dark:bg-blue-200 dark:hover:bg-blue-300 disabled:opacity-50 disabled:hover disabled:cursor-default`,
  lightDanger: `${baseClasses} font-medium bg-light-danger text-red-900 hover:bg-red-300 dark:bg-red-200 dark:hover:bg-red-300 disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  danger: `${baseClasses} font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 bg-red-400 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-400 text-white font-semibold disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  grayscale: `${baseClasses} bg-gray-button text-white opacity-80 hover:opacity-100 font-extralight disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  primaryOutline: `${baseClasses} bg-transparent text-primary border border-primary hover:border-primary-dark disabled:opacity-50 disabled:hover disabled:hover:cursor-default dark:bg-darkWhite dark:text-darkBlack dark:hover:bg-darkWhiteHover dark:border-darkBlack`,
};

const mapVariantToDarkModeVariant: Record<ButtonVariant, ButtonVariant> = {
  lightAccent: 'primary',
  lightDanger: 'danger',
  primary: 'primary',
  accent: 'accent',
  outline: 'outline',
  grayscale: 'grayscale',
  danger: 'danger',
  primaryOutline: 'primaryOutline',
};

export function Button({
  children,
  onClick,
  className = '',
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  const isDarkMode = () => {
    if (typeof window !== 'undefined') {
      return (
        window.matchMedia &&
        window.matchMedia('(prefers-color-scheme: dark)').matches
      );
    }
    return false;
  };

  const darkModeVariant = isDarkMode()
    ? mapVariantToDarkModeVariant[variant]
    : variant;

  return (
    <button
      onClick={onClick}
      className={`${baseClasses} ${buttonVariantClasses[darkModeVariant]} ${className}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
