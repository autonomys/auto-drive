import { useQuery } from '@tanstack/react-query';
import { useNetwork } from '../contexts/network';
import { coingecko } from '../services/coingecko';
import { useCallback } from 'react';

// This is longer because it's not a critical price & we're rate limited
const REFRESH_INTERVAL_COINGECKO = 1000 * 60 * 60;

const REFRESH_INTERVAL = 60 * 1000;

export const usePrices = () => {
  const { api } = useNetwork();

  const { data: ai3PerCreditsMb } = useQuery({
    queryKey: ['price'],
    queryFn: () => api.getCreditPrice().then((res) => res.price),
    refetchInterval: REFRESH_INTERVAL,
    gcTime: REFRESH_INTERVAL * 2,
  });

  const { data: usdPerAi3 } = useQuery({
    queryKey: ['coingeckoPrice'],
    queryFn: () => coingecko.getPrice(),
    staleTime: REFRESH_INTERVAL_COINGECKO,
    retry: 2,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: REFRESH_INTERVAL_COINGECKO,
    gcTime: REFRESH_INTERVAL_COINGECKO * 2,
  });

  const formatCreditsAsAi3 = useCallback(
    (creditsInMb: number) => {
      if (typeof ai3PerCreditsMb === 'undefined') {
        return 0;
      }

      return creditsInMb * ai3PerCreditsMb * 100;
    },
    [ai3PerCreditsMb],
  );

  const formatCreditsAsUsd = useCallback(
    (creditsInMb: number) => {
      if (typeof ai3PerCreditsMb === 'undefined') {
        return 0;
      }

      if (typeof usdPerAi3 === 'number') {
        return creditsInMb * ai3PerCreditsMb * usdPerAi3;
      }
      return 0;
    },
    [ai3PerCreditsMb, usdPerAi3],
  );

  const formatAi3AsCredits = useCallback(
    (ai3: number) => {
      if (typeof ai3PerCreditsMb === 'undefined') {
        return 0;
      }
      return ai3 / ai3PerCreditsMb;
    },
    [ai3PerCreditsMb],
  );

  const formatCreditsAsValue = useCallback(
    (creditsInMb: number): bigint => {
      if (typeof ai3PerCreditsMb === 'undefined') {
        return BigInt(0);
      }

      const precision = 10 ** 6;
      return (
        (BigInt(creditsInMb * ai3PerCreditsMb * precision) * BigInt(10 ** 18)) /
        BigInt(precision)
      );
    },
    [ai3PerCreditsMb],
  );

  return {
    ai3PerCreditsMb,
    usdPerAi3,
    formatCreditsAsAi3,
    formatCreditsAsUsd,
    formatCreditsAsValue,
    formatAi3AsCredits,
  };
};
