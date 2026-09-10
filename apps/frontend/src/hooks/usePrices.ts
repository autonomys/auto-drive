/* eslint-disable camelcase */
import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../contexts/network';
import { useCallback } from 'react';

const REFRESH_INTERVAL = 60 * 1000;

const BYTES_PER_MiB = 1024 ** 2;

/**
 * Storage pricing, in AI3 and — when the market supports a rate — in USD.
 *
 * Both halves now come from one backend call. The USD rate used to be fetched
 * straight from an exchange ticker in the browser; that market was suspended
 * and the ticker kept returning a last-trade price of zero, which this hook
 * cached for an hour and multiplied through every USD figure on the purchase
 * screen. The backend reads the WAI3/USDC pool instead, through the oracle that
 * already prices USDC purchases, and answers with no rate at all rather than a
 * meaningless one.
 *
 * So the USD formatters return `null`, not `0`, when there is no rate. Zero is
 * a price, and rendering it told users storage was free. Callers have to decide
 * what to show for an absent estimate, which is the point.
 */
export const usePrices = () => {
  const { api } = useNetwork();

  const { data: storagePrice } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getCreditPrice(),
    refetchInterval: REFRESH_INTERVAL,
    gcTime: REFRESH_INTERVAL * 2,
  });

  const shannonsPerByte = storagePrice?.price;
  const usdPerAi3 = storagePrice?.usd?.usdPerAi3 ?? null;
  // Surfaced so a UI can distinguish "no estimate" from "an estimate that
  // stopped updating", and say which.
  const usdRateStale = storagePrice?.usd?.stale ?? false;
  const usdRateAsOf = storagePrice?.usd?.asOf ?? null;
  const usdUnavailableReason = storagePrice?.usdUnavailableReason ?? null;

  const formatCreditsAsAi3 = useCallback(
    (credits: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }

      return (credits * shannonsPerByte) / 10 ** 18;
    },
    [shannonsPerByte],
  );

  const formatCreditsAsUsd = useCallback(
    (creditsInMb: number): number | null => {
      if (typeof shannonsPerByte === 'undefined' || usdPerAi3 === null) {
        return null;
      }

      return formatCreditsAsAi3(creditsInMb) * usdPerAi3;
    },
    [formatCreditsAsAi3, shannonsPerByte, usdPerAi3],
  );

  const formatCreditsInMbAsAi3 = useCallback(
    (creditsInMb: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }
      return formatCreditsAsAi3(creditsInMb * BYTES_PER_MiB);
    },
    [formatCreditsAsAi3, shannonsPerByte],
  );

  const formatCreditsInMbAsUsd = useCallback(
    (creditsInMb: number): number | null => {
      if (typeof shannonsPerByte === 'undefined' || usdPerAi3 === null) {
        return null;
      }
      return formatCreditsInMbAsAi3(creditsInMb) * usdPerAi3;
    },
    [formatCreditsInMbAsAi3, shannonsPerByte, usdPerAi3],
  );

  const formatAi3AsCredits = useCallback(
    (ai3: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }
      return (10 ** 18 * ai3) / shannonsPerByte;
    },
    [shannonsPerByte],
  );

  const formatAi3AsCreditsInMb = useCallback(
    (ai3: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }
      return (10 ** 18 * ai3) / (shannonsPerByte * BYTES_PER_MiB);
    },
    [shannonsPerByte],
  );

  const formatCreditsAsValue = useCallback(
    (creditsInMb: number): bigint => {
      if (typeof shannonsPerByte === 'undefined') {
        return BigInt(0);
      }

      const precision = 10 ** 6;
      return (
        (BigInt(creditsInMb * shannonsPerByte * precision) * BigInt(10 ** 18)) /
        BigInt(precision)
      );
    },
    [shannonsPerByte],
  );

  const formatCreditsInMbAsValue = useCallback(
    (creditsInMb: number): bigint => {
      if (typeof shannonsPerByte === 'undefined') {
        return BigInt(0);
      }

      return BigInt(creditsInMb * BYTES_PER_MiB) * BigInt(shannonsPerByte);
    },
    [shannonsPerByte],
  );

  return {
    shannonsPerByte,
    usdPerAi3,
    usdRateStale,
    usdRateAsOf,
    usdUnavailableReason,
    formatCreditsAsAi3,
    formatCreditsAsUsd,
    formatCreditsAsValue,
    formatAi3AsCredits,
    formatCreditsInMbAsAi3,
    formatCreditsInMbAsUsd,
    formatCreditsInMbAsValue,
    formatAi3AsCreditsInMb,
  };
};
