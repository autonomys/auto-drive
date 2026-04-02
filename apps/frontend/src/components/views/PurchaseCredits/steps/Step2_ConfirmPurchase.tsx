'use client';

import { Button } from '@auto-drive/ui';
import { InfoRow } from '../atoms/InfoRow';
import { Section } from '../atoms/Section';
import { useCallback, useMemo, useState, useEffect } from 'react';
import { Zap, AlertTriangle, Info } from 'lucide-react';
import { CreditCurrentPrice } from '../CreditCurrentPrice';
import { GoBackButton } from '../../../atoms/GoBackButton';
import { usePrices } from '../../../../hooks/usePrices';
import { formatBytes } from '../../../../utils/number';
import { useUserStore } from '../../../../globalStates/user';
import {
  UNITS,
  type Unit,
  MIB_PER_UNIT,
  bestUnit,
  mibToDisplay,
  sanitizeAmountInput,
  inputToMib,
  isCustomAmountOverCap,
} from '../../../../utils/purchaseCredits';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const PurchaseStep2ConnectWallet = ({
  onNext,
  onBack,
  context,
  onContextChange,
}: {
  onNext: (data?: Record<string, unknown>) => void;
  onBack: () => void;
  context: Record<string, unknown>;
  onContextChange: (data: Record<string, unknown>) => void;
}) => {
  const { formatCreditsInMbAsUsd, formatCreditsInMbAsAi3 } = usePrices();

  const isCustom = String(context.packageId ?? 'custom') === 'custom';

  const currentPurchasedBytes = useUserStore((s) =>
    s.creditSummary ? Number(s.creditSummary.uploadBytesRemaining) : 0,
  );

  const maxPurchasableBytes = useUserStore((s) =>
    s.creditSummary ? BigInt(s.creditSummary.maxPurchasableBytes) : null,
  );

  // -------------------------------------------------------------------------
  // Derive fixed-package title & size
  // -------------------------------------------------------------------------

  const { title, sizeMB } = useMemo(() => {
    const id = String(context.packageId ?? 'custom');
    switch (id) {
      case 'starter':
        return { title: 'Starter', sizeMB: 10 };
      case 'pro':
        return { title: 'Professional Package', sizeMB: 100 };
      case 'ent':
        return { title: 'Enterprise', sizeMB: 1024 };
      default:
        return { title: 'Custom Amount', sizeMB: (context.sizeMB as number) ?? 0 };
    }
  }, [context.packageId, context.sizeMB]);

  // -------------------------------------------------------------------------
  // Custom-amount local state: unit selector + raw string input value
  // -------------------------------------------------------------------------

  const [unit, setUnit] = useState<Unit>(() => bestUnit(sizeMB || 1));
  const [inputValue, setInputValue] = useState<string>(() =>
    mibToDisplay(sizeMB, bestUnit(sizeMB || 1)),
  );

  // When context sizeMB changes externally (e.g. navigating back), re-sync
  // the display value only if the input is empty (avoids clobbering typing).
  useEffect(() => {
    if (isCustom && sizeMB > 0 && inputValue === '') {
      const u = bestUnit(sizeMB);
      setUnit(u);
      setInputValue(mibToDisplay(sizeMB, u));
    }
  }, [isCustom, sizeMB, inputValue]);

  /** MiB value derived from the current input + unit. */
  const customSizeMib = useMemo(
    () => inputToMib(inputValue, unit),
    [inputValue, unit],
  );

  /** The effective MiB value for price calculations. */
  const effectiveMib = isCustom ? customSizeMib : sizeMB;

  // -------------------------------------------------------------------------
  // Cap validation
  // -------------------------------------------------------------------------

  const capExceeded = useMemo(
    () =>
      isCustom && isCustomAmountOverCap(effectiveMib, maxPurchasableBytes ?? null),
    [isCustom, maxPurchasableBytes, effectiveMib],
  );

  const maxPurchasableMib = useMemo(() => {
    if (maxPurchasableBytes === null) return null;
    return Number(maxPurchasableBytes / BigInt(1024 * 1024));
  }, [maxPurchasableBytes]);

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleInputChange = useCallback(
    (raw: string) => {
      // Allow only digits and a single decimal point — prevents leading zeros,
      // scientific notation ("1e5"), and negative values.
      const sanitised = sanitizeAmountInput(raw);
      setInputValue(sanitised);
      onContextChange({ sizeMB: inputToMib(sanitised, unit) });
    },
    [unit, onContextChange],
  );

  const handleUnitChange = useCallback(
    (newUnit: Unit) => {
      // Convert the current MiB value into the new unit to keep the
      // displayed number consistent with the underlying purchase size.
      const currentMib = parseFloat(inputValue) * MIB_PER_UNIT[unit];
      const newDisplay =
        isFinite(currentMib) && currentMib > 0 ? mibToDisplay(currentMib, newUnit) : '';
      setUnit(newUnit);
      setInputValue(newDisplay);
      // Keep context.sizeMB in sync so Step 3 sees the correct value
      // even if the user navigates forward without re-typing.
      onContextChange({ sizeMB: inputToMib(newDisplay, newUnit) });
    },
    [inputValue, unit, onContextChange],
  );

  // -------------------------------------------------------------------------
  // Derived price display values
  // -------------------------------------------------------------------------

  const ai3Amount = formatCreditsInMbAsAi3(effectiveMib);
  const usdAmount = formatCreditsInMbAsUsd(effectiveMib);
  const afterPurchaseBytes = currentPurchasedBytes + effectiveMib * 1024 * 1024;

  const canConfirm = effectiveMib > 0 && !capExceeded;

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className='flex flex-col gap-4'>
      <div>
        <GoBackButton onClick={onBack} />
      </div>
      <CreditCurrentPrice />

      <div className='grid grid-cols-1 gap-4 xl:grid-cols-3'>
        {/* Left: Order details */}
        <div className='xl:col-span-2'>
          <div className='flex flex-col gap-3 p-4'>
            <Section
              title={
                <div className='flex items-center gap-2'>
                  <Zap className='h-5 w-5 text-primary' />
                  Order Details
                </div>
              }
            >
              {/* Summary banner */}
              <div className='flex items-center justify-between rounded-md bg-muted p-4 dark:bg-gray-800'>
                <div className='flex flex-col'>
                  <div className='text-sm font-medium'>{title}</div>
                  <div className='text-xs text-muted-foreground'>
                    Permanent storage credits
                  </div>
                </div>
                <div className='text-right'>
                  <div className='text-xl font-bold'>
                    {formatBytes(effectiveMib * 1024 * 1024, 2)}
                  </div>
                  <div className='text-xs text-muted-foreground'>Storage</div>
                </div>
              </div>

              {/* Custom amount input */}
              {isCustom && (
                <div className='mt-2 flex flex-col gap-3 rounded-md border p-4'>
                  <div className='text-sm font-medium text-muted-foreground'>
                    Storage Amount
                  </div>

                  {/* Unit toggle + numeric input */}
                  <div className='flex items-center gap-3'>
                    <input
                      type='text'
                      inputMode='decimal'
                      placeholder='0'
                      className='w-40 rounded-md border px-3 py-2 text-xl font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-primary dark:bg-gray-800'
                      value={inputValue}
                      onChange={(e) => handleInputChange(e.target.value)}
                    />
                    {/* Unit selector */}
                    <div className='flex overflow-hidden rounded-md border'>
                      {UNITS.map((u) => (
                        <button
                          key={u}
                          type='button'
                          onClick={() => handleUnitChange(u)}
                          className={`px-4 py-2 text-sm font-medium transition-colors ${
                            unit === u
                              ? 'bg-primary text-primary-foreground'
                              : 'bg-background text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          {u}
                        </button>
                      ))}
                    </div>
                    {/* Binary-units info bubble */}
                    <div className='group relative'>
                      <Info className='h-4 w-4 cursor-help text-muted-foreground' />
                      <div className='pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 w-64 -translate-x-1/2 rounded-md bg-gray-900 px-3 py-2 text-xs leading-relaxed text-white opacity-0 shadow-lg transition-opacity group-hover:opacity-100 dark:bg-gray-700'>
                        <p className='font-semibold'>About these units</p>
                        <p className='mt-1 text-gray-300'>
                          We use binary units — like most storage hardware.
                          That means:
                        </p>
                        <ul className='mt-1.5 space-y-0.5 text-gray-200'>
                          <li>1 GB&nbsp;=&nbsp;1,024 MB&nbsp;<span className='text-gray-400'>(not 1,000)</span></li>
                          <li>1 TB&nbsp;=&nbsp;1,024 GB&nbsp;<span className='text-gray-400'>(not 1,000)</span></li>
                        </ul>
                      </div>
                    </div>
                  </div>

                  {/* Cap-exceeded warning */}
                  {capExceeded && maxPurchasableMib !== null && (
                    <div className='flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                      <AlertTriangle className='mt-0.5 h-4 w-4 shrink-0' />
                      <span>
                        Exceeds your remaining cap.{' '}
                        Maximum you can purchase:{' '}
                        <strong>{formatBytes(maxPurchasableMib * 1024 * 1024, 2)}</strong>
                      </span>
                    </div>
                  )}

                  {/* Zero-amount hint */}
                  {effectiveMib === 0 && inputValue !== '' && (
                    <div className='text-xs text-muted-foreground'>
                      Enter an amount greater than 0.
                    </div>
                  )}
                </div>
              )}

              {/* Price breakdown (read-only) */}
              <InfoRow
                label='Storage Amount'
                value={<span>{formatBytes(effectiveMib * 1024 * 1024, 2)}</span>}
              />
              <InfoRow
                label='AI3 Token Amount'
                value={
                  <span>{ai3Amount > 0 ? `${ai3Amount.toFixed(6)} AI3` : '—'}</span>
                }
              />
              <InfoRow
                label='USD Equivalent'
                value={
                  <span>
                    {usdAmount > 0 ? `$${usdAmount.toFixed(2)}` : '—'}
                  </span>
                }
              />
              <div className='flex flex-col rounded-md border-b-2 border-gray-200' />
              <div className='mt-2'>
                <InfoRow
                  label='Total'
                  value={
                    <span className='font-semibold'>
                      {ai3Amount > 0 ? `${ai3Amount.toFixed(2)} AI3` : '—'}
                    </span>
                  }
                  accent
                />
              </div>
            </Section>
          </div>
        </div>

        {/* Right: Payment summary */}
        <div className='xl:col-span-1'>
          <Section title='Complete Payment'>
            <div className='flex flex-col gap-3 p-4'>
              <InfoRow
                label='Current Purchased Credits'
                className='rounded-md bg-gray-100 p-4 dark:bg-gray-800'
                value={<span>{formatBytes(currentPurchasedBytes, 2)}</span>}
              />
              <InfoRow
                label='After Purchase'
                value={
                  <span className='font-semibold'>
                    {effectiveMib > 0
                      ? formatBytes(afterPurchaseBytes, 2)
                      : formatBytes(currentPurchasedBytes, 2)}
                  </span>
                }
                className='rounded-md bg-primary/20 p-4'
                accent
              />
              <div className='flex gap-3 pt-2'>
                <Button variant='outline' onClick={onBack} className='w-1/3'>
                  Back
                </Button>
                <Button
                  disabled={!canConfirm}
                  onClick={() => {
                    if (canConfirm) onNext({ sizeMB: effectiveMib });
                  }}
                  className='w-2/3'
                >
                  Confirm Purchase
                </Button>
              </div>
              <div className='text-xs text-muted-foreground'>
                Next, you will connect your wallet to complete the AI3 token
                transfer
              </div>
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};
