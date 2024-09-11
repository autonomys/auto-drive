import React, { MouseEventHandler, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'outline'

export interface ButtonProps {
    children: ReactNode
    onClick?: MouseEventHandler<HTMLButtonElement>
    className?: string
    variant?: ButtonVariant
}

const baseClasses = 'px-4 py-2 font-semibold rounded-lg shadow-sm focus:outline-none focus:ring-2 focus:ring-opacity-75 transition-colors duration-200'

export const buttonVariantClasses: Record<ButtonVariant, string> = {
    primary: `${baseClasses} bg-blue-500 text-white hover:bg-blue-700 focus:ring-blue-400`,
    secondary: `${baseClasses} bg-gray-500 text-white hover:bg-gray-700 focus:ring-gray-400`,
    outline: `${baseClasses} bg-transparent text-blue-500 hover:text-blue-700 border border-gray-100 hover:border-blue-200`
}

export function Button({
    children,
    onClick,
    className = '',
    variant = 'primary'
}: ButtonProps) {


    return (
        <button
            onClick={onClick}
            className={`${baseClasses} ${buttonVariantClasses[variant]} ${className}`}
        >
            {children}
        </button>
    )
}
