'use client';

import { useQuery } from '@tanstack/react-query';
import { UsdcPaymentTarget } from '@auto-drive/models';
import { findUsdcPaymentChain } from '@auto-drive/ui';
import { useNetwork } from '../contexts/network';

/**
 * Whether this user can pay in USDC right now, and where to send it.
 *
 * Three facts have to line up, and none of them is a build-time constant:
 *
 *   - `payWithUsdc` from `/features`, which the backend has ALREADY narrowed to
 *     audience AND availability (see withUsdcAvailability). So one boolean is the
 *     honest answer to "offer this option", and the UI never re-derives it — two
 *     evaluations of that question that can disagree is a screen offering a path
 *     the backend then refuses.
 *   - a payment target: the chain, receiver and token the deployment names.
 *   - a chain this client actually knows. An unrecognised id is not something to
 *     work around: a wallet cannot be switched to a chain wagmi was never
 *     configured with, and inventing a definition for it is how a payment lands
 *     on something that merely resembles the intended network.
 *
 * Read through react-query rather than the user store, and that is a correctness
 * point rather than a preference. The store holds `{}` until the first fetch
 * lands, so "no answer yet" and "the answer is no" are the same value there —
 * which would flash "USDC payments are temporarily unavailable" on every fresh
 * load of the purchase page before settling. The query separates them.
 *
 * `refetchOnMount: 'always'` because a user can sit on this page for an hour,
 * and being offered a method that closed twenty minutes ago is worse than not
 * being offered it. It shares the ['features'] cache entry with SessionEnsurer,
 * so this is a refresh rather than a second request. That still leaves a race —
 * the gate can close between the click and `POST /intents` — which is closed on
 * the other side, by the 503 the purchase flow falls back on.
 */
export const useUsdcAvailability = () => {
  const { api } = useNetwork();

  const { data: features, isPending: featuresPending } = useQuery<
    Record<string, boolean>
  >({
    queryKey: ['features'],
    queryFn: () => api.getFeatures(),
    refetchOnMount: 'always',
  });

  const offered = features?.payWithUsdc === true;

  const { data: target, isPending: targetPending } =
    useQuery<UsdcPaymentTarget>({
      queryKey: ['usdcPaymentTarget'],
      queryFn: () => api.getUsdcPaymentTarget(),
      // Only asked for once the option is actually on offer. A deployment that
      // does not sell USDC answers 403, and spending a request per page view to be
      // told so is a cost with no reader.
      enabled: offered,
      // Deployment configuration: it changes on a redeploy, not between renders.
      staleTime: 5 * 60 * 1000,
      // A 403 is an answer, not a hiccup — retrying it three times delays the
      // honest "not available" by several seconds.
      retry: false,
    });

  const chain = target ? findUsdcPaymentChain(target.chainId) : undefined;

  // Still waiting on something needed to decide. A disabled query reports
  // `isPending` forever, so the target's pending state only counts while it is
  // actually enabled.
  const isLoading = featuresPending || (offered && targetPending);

  return {
    /**
     * Safe to offer USDC. Requires the target to have arrived AND to name a
     * chain this build can switch to, so a component reading `true` here can
     * always complete the flow.
     */
    isAvailable: offered && Boolean(target) && Boolean(chain),
    /** True until every input above has an answer, so callers can wait rather than flicker. */
    isLoading,
    target,
    chain,
    /**
     * The deployment offers USDC but this client cannot pay it — an unknown
     * chain id, or a target that would not load.
     *
     * Rendered as its own sentence by the USDC panel rather than folded into
     * "temporarily unavailable", because the two have opposite advice: a closed
     * gate is worth waiting out, and a build that does not know the deployment's
     * chain never clears on its own.
     */
    isUnsupported: offered && !isLoading && (!target || !chain),
  };
};
