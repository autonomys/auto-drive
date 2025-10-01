import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../contexts/network';
import { tokenPriceService } from '../services/coingecko';
import { useCallback } from 'react';

// This is longer because it's not a critical price & we're rate limited
const REFRESH_INTERVAL_COINGECKO = 1000 * 60 * 60;

const REFRESH_INTERVAL = 60 * 1000;

const BYTES_PER_MB = 10 ** 6;

export const usePrices = () => {
  const { api } = useNetwork();

  const { data: shannonsPerByte } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getCreditPrice().then((res) => res.price),
    refetchInterval: REFRESH_INTERVAL,
    gcTime: REFRESH_INTERVAL * 2,
  });

  const { data: usdPerAi3 } = useQuery({
    queryKey: ['coingeckoPrice'],
    queryFn: () => tokenPriceService.getPrice(),
    refetchInterval: REFRESH_INTERVAL_COINGECKO,
    gcTime: REFRESH_INTERVAL_COINGECKO * 2,
    initialData: 0.052,
  });

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
    (creditsInMb: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }

      if (typeof usdPerAi3 === 'number') {
        return formatCreditsAsAi3(creditsInMb) * usdPerAi3;
      }
      return 0;
    },
    [formatCreditsAsAi3, shannonsPerByte, usdPerAi3],
  );

  const formatCreditsInMbAsAi3 = useCallback(
    (creditsInMb: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
      }
      return formatCreditsAsAi3(creditsInMb * BYTES_PER_MB);
    },
    [formatCreditsAsAi3, shannonsPerByte],
  );

  const formatCreditsInMbAsUsd = useCallback(
    (creditsInMb: number) => {
      if (typeof shannonsPerByte === 'undefined') {
        return 0;
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
      return (10 ** 18 * ai3) / (shannonsPerByte * BYTES_PER_MB);
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

      return BigInt(creditsInMb * BYTES_PER_MB) * BigInt(shannonsPerByte);
    },
    [shannonsPerByte],
  );

  return {
    shannonsPerByte,
    usdPerAi3,
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
