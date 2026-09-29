/**
 * @jest-environment jsdom
 */

/**
 * The size a custom purchase is actually confirmed for.
 *
 * Step 2 shows the amount in a text box, and that string is lossy —
 * `mibToDisplay` trims to four significant figures. While the box was the source
 * of truth, simply arriving on this screen and pressing Confirm re-derived the
 * size from its own rounded display: 20,000 MiB became 19,999, and 90% of custom
 * sizes above 1 GB drifted the same way.
 *
 * It is not a rounding nit. Coming back to this step from the one after it is
 * the ordinary way to reach it, and the USDC step matches its in-flight payment
 * record on the exact size — so a purchase that quietly resized on the way past
 * arrived looking like a different one, with the payment already on chain no
 * longer attached to it.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Stubs (before the import under test)
// ---------------------------------------------------------------------------

jest.mock('../../../src/hooks/useUsdcAvailability', () => ({
  useUsdcAvailability: () => ({
    isAvailable: false,
    isLoading: false,
    chain: undefined,
    isUnsupported: false,
  }),
}));

// Required: jest.config maps this package to its `constants/` source, which
// exports no components.
jest.mock('@auto-drive/ui', () => ({
  Button: ({
    children,
    onClick,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    disabled?: boolean;
  }) => createElement('button', { onClick, disabled }, children),
  cn: (...classes: unknown[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
}));

jest.mock('../../../src/hooks/usePrices', () => ({
  usePrices: () => ({
    shannonsPerByte: 1,
    formatCreditsAsAi3: () => 1,
    formatCreditsInMbAsUsd: () => 1,
    formatCreditsInMbAsAi3: () => 1,
  }),
}));

jest.mock('../../../src/globalStates/user', () => ({
  useUserStore: (select: (state: unknown) => unknown) =>
    select({
      creditSummary: {
        uploadBytesRemaining: '0',
        // Well above every size below, so nothing here is refused by the cap.
        maxPurchasableBytes: '1099511627776000',
      },
    }),
}));

import { PurchaseStep2ConnectWallet } from '../../../src/components/views/PurchaseCredits/steps/Step2_ConfirmPurchase';

const onNext = jest.fn<(data?: Record<string, unknown>) => void>();

/** The wizard around the step, in the shape that matters. */
const Harness = ({ sizeMB }: { sizeMB: number }) => {
  const [context, setContext] = useState<Record<string, unknown>>({
    packageId: 'custom',
    sizeMB,
  });
  return createElement(PurchaseStep2ConnectWallet, {
    onNext,
    onBack: () => {},
    context,
    onContextChange: (data: Record<string, unknown>) =>
      setContext((prev) => ({ ...prev, ...data })),
  });
};

const amountInput = () =>
  document.querySelector('input') as HTMLInputElement | null;

const confirm = () =>
  screen.getByRole('button', {
    name: /Confirm Purchase/,
  }) as HTMLButtonElement;

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Step 2 — the size a custom purchase confirms for', () => {
  // The four-significant-figure display cannot hold any of these exactly.
  it.each([20000, 12345, 77777])(
    'confirms %i MiB, the figure it was given',
    async (sizeMB) => {
      render(createElement(Harness, { sizeMB }));

      fireEvent.click(confirm());

      await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
      expect(onNext.mock.calls[0][0]).toMatchObject({ sizeMB });
    },
  );

  it('shows the rounded figure, which is only a display', () => {
    // The box is allowed to be lossy. What it must not be is the source of
    // truth: 20000 MiB is 19.53125 GB, and four significant figures is 19.53.
    render(createElement(Harness, { sizeMB: 20000 }));

    expect(amountInput()?.value).toBe('19.53');
  });

  it('takes the typed figure once the buyer types one', async () => {
    render(createElement(Harness, { sizeMB: 20000 }));

    const input = amountInput();
    if (!input) throw new Error('no amount input');
    fireEvent.change(input, { target: { value: '10' } });

    await waitFor(() => expect(amountInput()?.value).toBe('10'));
    fireEvent.click(confirm());

    // 10 GB, not the 20,000 MiB it arrived with: an edit is an edit.
    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(onNext.mock.calls[0][0]).toMatchObject({ sizeMB: 10240 });
  });

  it('does not resize on a click that picks the unit already shown', async () => {
    // The display is rounded, so anything that round-trips the size through it
    // is a resize. Re-picking the current unit asks for nothing and must do
    // nothing — before this it quietly bought 19,999.
    render(createElement(Harness, { sizeMB: 20000 }));

    fireEvent.click(screen.getByRole('button', { name: /^GB$/ }));
    fireEvent.click(confirm());

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(onNext.mock.calls[0][0]).toMatchObject({ sizeMB: 20000 });
  });

  it.each([0.5, 'abc', undefined, -5, NaN])(
    'survives a query string carrying %p as the size',
    (sizeMB) => {
      // The size arrives from the URL. Now that it IS the purchase size rather
      // than a seed for the input box, an unnormalised one would reach `BigInt`
      // in the cap check and take the whole screen down.
      expect(() =>
        render(createElement(Harness, { sizeMB: sizeMB as unknown as number })),
      ).not.toThrow();
    },
  );

  it.each(['abc', undefined, -5])(
    'refuses to confirm a purchase of %p',
    (sizeMB) => {
      // Nothing the URL could not express as a size is bought by accident. A
      // fractional one is not in this list: `normaliseMib` rounds it, so 0.5
      // is a 1 MiB purchase rather than a refusal.
      render(createElement(Harness, { sizeMB: sizeMB as unknown as number }));
      expect(confirm().disabled).toBe(true);
    },
  );

  it('leaves a fixed package alone', async () => {
    // Fixed sizes never went through the text box, so this is a guard rather
    // than a fix — the same assertion that was already true.
    render(
      createElement(() => {
        const [context, setContext] = useState<Record<string, unknown>>({
          packageId: 'pro',
        });
        return createElement(PurchaseStep2ConnectWallet, {
          onNext,
          onBack: () => {},
          context,
          onContextChange: (data: Record<string, unknown>) =>
            setContext((prev) => ({ ...prev, ...data })),
        });
      }, {}),
    );

    fireEvent.click(confirm());

    await waitFor(() => expect(onNext).toHaveBeenCalledTimes(1));
    expect(onNext.mock.calls[0][0]).toMatchObject({ sizeMB: 1024 });
  });
});
