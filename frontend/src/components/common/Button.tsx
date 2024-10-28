import React, { MouseEventHandler, ReactNode } from "react";

type ButtonVariant =
  | "primary"
  | "accent"
  | "outline"
  | "grayscale"
  | "danger"
  | "lightAccent"
  | "lightDanger";

export interface ButtonProps {
  children: ReactNode;
  onClick?: MouseEventHandler<HTMLButtonElement>;
  className?: string;
  variant?: ButtonVariant;
  disabled?: boolean;
}

const baseClasses =
  "px-4 py-2 rounded-lg shadow-sm focus:outline-none transition-colors duration-200";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: `${baseClasses} bg-primary text-white hover:opacity-80 disabled:opacity-50 disabled:hover:opacity-50 disabled:hover:cursor-default`,
  accent: `${baseClasses} bg-accent text-white opacity-100 hover:opacity-80 disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  outline: `${baseClasses} bg-transparent text-accent hover:text-accent-dark border border-accent hover:border-accent-dark disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  lightAccent: `${baseClasses} font-medium bg-blue-100 text-blue-900 hover:bg-blue-200 disabled:opacity-50 disabled:hover disabled:cursor-default`,
  lightDanger: `${baseClasses} font-medium bg-light-danger text-red-900 hover:bg-red-200 disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  danger: `${baseClasses} font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 bg-red-400 text-white hover:bg-red-500 font-semibold disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
  grayscale: `${baseClasses} bg-gray-button text-white opacity-80 hover:opacity-100 font-extralight disabled:opacity-50 disabled:hover disabled:hover:cursor-default`,
};

export function Button({
  children,
  onClick,
  className = "",
  variant = "primary",
  disabled = false,
}: ButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`${baseClasses} ${buttonVariantClasses[variant]} ${className}`}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
