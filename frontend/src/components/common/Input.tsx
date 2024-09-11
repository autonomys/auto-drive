import React, { InputHTMLAttributes } from 'react'

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string
    error?: string
    variant?: 'default' | 'success' | 'error'
}

export function Input({
    label,
    error,
    variant = 'default',
    className = '',
    ...props
}: InputProps) {
    const baseClasses = 'w-full px-3 py-2 border rounded-md focus:outline-none focus:ring-2 transition-colors duration-200'
    const variantClasses = {
        default: 'border-gray-300 focus:border-blue-500 focus:ring-blue-200',
        success: 'border-green-500 focus:border-green-500 focus:ring-green-200',
        error: 'border-red-500 focus:border-red-500 focus:ring-red-200'
    }

    return (
        <div className="mb-4">
            {label && (
                <label className="block mb-2 text-sm font-bold text-gray-700" htmlFor={props.id}>
                    {label}
                </label>
            )}
            <input
                className={`${baseClasses} ${variantClasses[variant]} ${className}`}
                {...props}
            />
            {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
        </div>
    )
}