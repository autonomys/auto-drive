/**
 * @jest-environment jsdom
 */

/**
 * What a buyer is told when USDC closes under their feet.
 *
 * Step 2 corrects a USDC choice that is no longer on offer, writing AI3 back
 * into the purchase context. That correction used to erase its own explanation:
 * the notice was derived from `context.paymentMethod`, so one render after the
 * effect there was nothing left to derive it from, and with USDC unavailable the
 * selector's own `if (!usdcAvailable && !closedNotice) return null` took the
 * whole control off screen. The buyer saw the USDC button vanish, within a
 * frame, with no sentence saying why.
 *
 * Which is why this renders the component rather than a helper. The defect was
 * not in choosing the wording — that code was correct and unreachable — but in
 * the lifecycle around it, and only a render sees a lifecycle.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { render, screen, waitFor } from '@testing-library/react';
import { createElement, useState, type ReactNode } from 'react';

// ---------------------------------------------------------------------------
// Stubs (before the import under test)
// ---------------------------------------------------------------------------

type Availability = {
  isAvailable: boolean;
  isLoading: boolean;
  chain: { name: string } | undefined;
  isUnsupported: boolean;
};

let availability: Availability;

jest.mock('../../../src/hooks/useUsdcAvailability', () => ({
  useUsdcAvailability: () => availability,
}));

// Required, not optional: jest.config maps this package to its `constants/`
// source, which exports no components at all. Only the props these assertions
// read are forwarded; `className` and `size` are passed by the screen and
// dropped here, which nothing below looks at.
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
        maxPurchasableBytes: '1099511627776',
      },
    }),
}));

import { PaymentMethod } from '@auto-drive/models';
import { PurchaseStep2ConnectWallet } from '../../../src/components/views/PurchaseCredits/steps/Step2_ConfirmPurchase';

const USDC_ETH = PaymentMethod.USDC_ETH;

const onContextChange = jest.fn<(data: Record<string, unknown>) => void>();

let renders = 0;

/**
 * The wizard around the step, in the shape that matters.
 *
 * `onContextChange` is an inline arrow in PurchaseCredits/index.tsx — a new
 * identity every render — and it merges into context with `{ ...prev, ...data }`.
 * Both are reproduced, because both are what a latch here has to survive. Its
 * other half, `navigateWithParams`, is not: the URL cannot undo the correction,
 * since the init effect merges with `prev` winning.
 */
const Harness = ({ initialMethod }: { initialMethod?: string }) => {
  const [context, setContext] = useState<Record<string, unknown>>({
    packageId: 'starter',
    paymentMethod: initialMethod,
  });
  renders += 1;
  return createElement(PurchaseStep2ConnectWallet, {
    onNext: () => {},
    onBack: () => {},
    context,
    onContextChange: (data: Record<string, unknown>) => {
      onContextChange(data);
      setContext((prev) => ({ ...prev, ...data }));
    },
  });
};

const CLOSED = /USDC payments are temporarily unavailable/;
const UNSUPPORTED = /cannot pay USDC on the network/;

const usdcButton = () =>
  screen.queryByRole('button', { name: /USDC/ }) as HTMLButtonElement | null;

beforeEach(() => {
  jest.clearAllMocks();
  renders = 0;
  availability = {
    isAvailable: false,
    isLoading: false,
    chain: undefined,
    isUnsupported: false,
  };
});

describe('Step 2 — a USDC choice that closed', () => {
  it('keeps the explanation on screen after correcting the choice', async () => {
    render(createElement(Harness, { initialMethod: USDC_ETH }));

    // The correction still happens: nothing here preserves a method the
    // deployment would refuse.
    await waitFor(() =>
      expect(onContextChange).toHaveBeenCalledWith({
        paymentMethod: PaymentMethod.AI3_NATIVE,
      }),
    );

    // And the sentence outlives it. Before the latch both this and the whole
    // selector were gone by now.
    expect(screen.getByText(CLOSED)).toBeDefined();
    expect(usdcButton()?.disabled).toBe(true);
  });

  it('settles, rather than correcting itself in a loop', async () => {
    render(createElement(Harness, { initialMethod: USDC_ETH }));

    await waitFor(() => expect(onContextChange).toHaveBeenCalledTimes(1));
    const settled = renders;

    // The effect re-runs on every render — `onContextChange`'s identity changes
    // each time — so "it corrects once" is a claim about the guard, not about
    // the dependency array.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(onContextChange).toHaveBeenCalledTimes(1);
    expect(renders).toBe(settled);
  });

  it('re-reads which kind of closure it was, after latching', async () => {
    // `isUnsupported` can resolve after the gate has already closed — the target
    // request is still in flight when `offered` goes false. Latching the
    // SENTENCE would leave the screen saying "temporarily" about a build that
    // can never pay this chain, so the fact is latched and the wording is read
    // at render. `rerender` rather than a fresh mount, because the point is that
    // this happens to an instance that has already latched.
    const { rerender } = render(
      createElement(Harness, { initialMethod: USDC_ETH }),
    );
    await waitFor(() => expect(screen.getByText(CLOSED)).toBeDefined());

    availability = { ...availability, isUnsupported: true };
    rerender(createElement(Harness, { initialMethod: USDC_ETH }));

    await waitFor(() => expect(screen.getByText(UNSUPPORTED)).toBeDefined());
    expect(screen.queryByText(CLOSED)).toBeNull();
    // Still the same instance: a remount would re-read USDC from the context it
    // was given and correct it a second time.
    expect(onContextChange).toHaveBeenCalledTimes(1);
  });

  it('drops the notice once USDC is on offer again', async () => {
    const { rerender } = render(
      createElement(Harness, { initialMethod: USDC_ETH }),
    );
    await waitFor(() => expect(screen.getByText(CLOSED)).toBeDefined());

    availability = {
      isAvailable: true,
      isLoading: false,
      chain: { name: 'Ethereum' },
      isUnsupported: false,
    };
    rerender(createElement(Harness, { initialMethod: USDC_ETH }));

    // Both methods on offer, and no stale sentence left under them.
    await waitFor(() => expect(usdcButton()?.disabled).toBe(false));
    expect(screen.queryByText(CLOSED)).toBeNull();
  });

  it('says nothing while the answer is still loading', async () => {
    // The invariant that keeps a fresh page load honest. `isAvailable` is false
    // during the in-flight window too, so without the `!usdcLoading` guard every
    // load of this page with USDC chosen would flash "temporarily unavailable"
    // and discard a perfectly valid choice a fraction of a second later.
    availability = { ...availability, isLoading: true };
    const { rerender } = render(
      createElement(Harness, { initialMethod: USDC_ETH }),
    );

    expect(screen.queryByText(CLOSED)).toBeNull();
    expect(onContextChange).not.toHaveBeenCalled();

    availability = {
      isAvailable: true,
      isLoading: false,
      chain: { name: 'Ethereum' },
      isUnsupported: false,
    };
    rerender(createElement(Harness, { initialMethod: USDC_ETH }));

    await waitFor(() => expect(usdcButton()?.disabled).toBe(false));
    expect(screen.queryByText(CLOSED)).toBeNull();
    expect(onContextChange).not.toHaveBeenCalled();
  });

  it('explains a gate that closes mid-session', async () => {
    // The ['features'] query refetches on window focus — which the wallet's own
    // popup causes — so this is the route a buyer actually takes to it, rather
    // than arriving on a page that was already shut.
    availability = {
      isAvailable: true,
      isLoading: false,
      chain: { name: 'Ethereum' },
      isUnsupported: false,
    };
    const { rerender } = render(
      createElement(Harness, { initialMethod: USDC_ETH }),
    );
    await waitFor(() => expect(usdcButton()?.disabled).toBe(false));

    availability = { ...availability, isAvailable: false, chain: undefined };
    rerender(createElement(Harness, { initialMethod: USDC_ETH }));

    await waitFor(() => expect(screen.getByText(CLOSED)).toBeDefined());
    expect(usdcButton()?.disabled).toBe(true);
  });

  it('renders no selector at all on an AI3-only deployment', () => {
    render(createElement(Harness, {}));

    // The ordinary case, and the reason the notice needs a latch: with nothing
    // latched the selector is absent entirely rather than present-and-inert.
    expect(usdcButton()).toBeNull();
    expect(screen.queryByText(CLOSED)).toBeNull();
    expect(onContextChange).not.toHaveBeenCalled();
  });
});
