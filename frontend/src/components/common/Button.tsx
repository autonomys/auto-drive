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
  "px-4 py-2 rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-colors duration-200";

export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: `${baseClasses} bg-primary text-white hover:opacity-80`,
  accent: `${baseClasses} bg-accent text-white opacity-100 hover:opacity-80`,
  outline: `${baseClasses} bg-transparent text-accent hover:text-accent-dark border border-accent hover:border-accent-dark`,
  lightAccent: `${baseClasses} font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 bg-blue-100 text-blue-900 hover:bg-blue-200`,
  lightDanger: `${baseClasses} font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-light-danger focus-visible:ring-offset-2 bg-light-danger text-red-900 hover:bg-red-200`,
  danger: `${baseClasses} font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500 focus-visible:ring-offset-2 bg-red-400 text-white hover:bg-red-500 font-semibold`,
  grayscale: `${baseClasses} bg-gray-button text-white opacity-80 hover:opacity-100 font-extralight`,
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
