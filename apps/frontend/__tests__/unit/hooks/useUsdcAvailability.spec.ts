/**
 * @jest-environment jsdom
 */

/**
 * Whether the buyer is offered USDC at all.
 *
 * Two failure modes are worth a test rather than a comment. Offering a method
 * the backend then refuses is one — a 503 under a Pay button the screen
 * promised — and the other is the reverse: flashing "unavailable" on a page that
 * has simply not finished asking. The second is why this reads through
 * react-query and not the user store, where "no answer yet" and "the answer is
 * no" are the same `{}`.
 */

import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { renderHook, waitFor } from '@testing-library/react';
import {
  QueryClient,
  QueryClientProvider,
  type QueryClientConfig,
} from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';

const getFeatures = jest.fn<() => Promise<Record<string, boolean>>>();
const getUsdcPaymentTarget = jest.fn<() => Promise<unknown>>();

jest.mock('../../../src/contexts/network', () => ({
  useNetwork: () => ({ api: { getFeatures, getUsdcPaymentTarget } }),
}));

import { useUsdcAvailability } from '../../../src/hooks/useUsdcAvailability';

const MAINNET_TARGET = {
  chainId: 1,
  receiverAddress: '0x1111111111111111111111111111111111111111',
  tokenAddress: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  tokenDecimals: 6,
  confirmations: 6,
  settleGraceMs: 120_000,
};

const QUIET: QueryClientConfig = {
  defaultOptions: { queries: { retry: false } },
};

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient(QUIET) },
    children,
  );

const render = () => renderHook(() => useUsdcAvailability(), { wrapper });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('useUsdcAvailability', () => {
  it('is available when the backend offers it and names a chain this build knows', async () => {
    getFeatures.mockResolvedValue({ payWithUsdc: true });
    getUsdcPaymentTarget.mockResolvedValue(MAINNET_TARGET);

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAvailable).toBe(true);
    expect(result.current.chain?.id).toBe(1);
    expect(result.current.isUnsupported).toBe(false);
  });

  it('reports loading rather than unavailable while the answer is in flight', async () => {
    // The correctness point behind reading this through react-query. Treating
    // "not asked yet" as "no" flashes an unavailable banner on every fresh load
    // of the purchase page, and — worse, in Step 2 — silently rewrites a USDC
    // choice to AI3 a fraction of a second after the page opens.
    getFeatures.mockReturnValue(new Promise(() => {}));

    const { result } = render();

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isUnsupported).toBe(false);
  });

  it('never offers USDC when the backend has not', async () => {
    // One boolean, narrowed by the backend to audience AND availability. The UI
    // does not re-derive it: two evaluations of that question that can disagree
    // is a screen offering a path the backend then refuses.
    getFeatures.mockResolvedValue({ payWithUsdc: false });

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAvailable).toBe(false);
    // Not asked for: a deployment that does not sell USDC answers 403, and
    // spending a request per page view to be told so has no reader.
    expect(getUsdcPaymentTarget).not.toHaveBeenCalled();
  });

  it('reports a chain this build does not know as unsupported, not unavailable', async () => {
    // The two have opposite advice. A closed gate is worth waiting out; a build
    // that cannot switch a wallet to the deployment's chain never clears, and
    // inventing a chain definition to cope is how a payment lands on something
    // that merely resembles the intended network.
    getFeatures.mockResolvedValue({ payWithUsdc: true });
    getUsdcPaymentTarget.mockResolvedValue({
      ...MAINNET_TARGET,
      chainId: 1337,
    });

    const { result } = render();

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAvailable).toBe(false);
    expect(result.current.isUnsupported).toBe(true);
    expect(result.current.chain).toBeUndefined();
  });

  it('is unsupported, not available, when the target itself will not load', async () => {
    getFeatures.mockResolvedValue({ payWithUsdc: true });
    getUsdcPaymentTarget.mockRejectedValue(new Error('403'));

    const { result } = render();

    await waitFor(() => expect(result.current.isUnsupported).toBe(true));
    expect(result.current.isAvailable).toBe(false);
  });
});
