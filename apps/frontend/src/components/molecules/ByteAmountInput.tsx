'use client';

import { ReactNode } from 'react';
import { BYTE_UNITS, ByteUnit } from '@/utils/byteUnits';

/** A labelled byte amount, typed as a number of MB, GB or TB. */
export const ByteAmountInput = ({
  label,
  amount,
  unit,
  onChange,
  placeholder,
  children,
}: {
  label: ReactNode;
  amount: string;
  unit: ByteUnit;
  onChange: (value: { amount: string; unit: ByteUnit }) => void;
  placeholder?: string;
  /** Shown under the input. */
  children?: ReactNode;
}) => (
  <label className='block text-sm text-foreground'>
    {label}
    <span className='flex gap-2'>
      <input
        type='text'
        inputMode='decimal'
        className='w-full min-w-0 flex-1 rounded border border-border bg-background px-2 py-1 text-foreground'
        placeholder={placeholder}
        value={amount}
        onChange={(e) => onChange({ amount: e.target.value, unit })}
      />
      <select
        aria-label='Unit'
        className='rounded border border-border bg-background px-2 py-1 text-foreground'
        value={unit}
        onChange={(e) => onChange({ amount, unit: e.target.value as ByteUnit })}
      >
        {Object.keys(BYTE_UNITS).map((u) => (
          <option key={u} value={u}>
            {u}
          </option>
        ))}
      </select>
    </span>
    {children}
  </label>
);
