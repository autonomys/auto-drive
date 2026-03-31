import { SessionContext } from 'next-auth/react';
import { useContext, useEffect } from 'react';
import { useUserStore } from '../../globalStates/user';
import { useTouStore } from '../../globalStates/tou';
import { useNetwork } from '../../contexts/network';
import { AuthService } from '../../services/auth/auth';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CreditSummaryResponse } from '../../services/api';
import { TouChangeType } from '@auto-drive/models';
import { TouAcceptanceInterstitial } from '../views/TouAcceptance';

export const SessionEnsurer = ({ children }: { children: React.ReactNode }) => {
  const router = useRouter();
  const session = useContext(SessionContext);
  const setUser = useUserStore(({ setUser }) => setUser);
  const setFeatures = useUserStore(({ setFeatures }) => setFeatures);
  const setAccount = useUserStore((m) => m.setAccount);
  const setCreditSummary = useUserStore((m) => m.setCreditSummary);
  const touStatus = useTouStore((m) => m.touStatus);
  const setTouStatus = useTouStore((m) => m.setTouStatus);
  const { api } = useNetwork();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (session === undefined) return;

    if (session.data === null) {
      setUser(null);
      setTouStatus(null);
    } else {
      AuthService.getMe()
        .then((user) => {
          if (user.onboarded) {
            setUser(user);
          } else {
            setUser(null);
            router.push('/onboarding');
          }
        })
        .catch(() => {
          setUser(null);
        });
    }
  }, [api, router, session, session?.data, setAccount, setUser]);

  const { data: account } = useQuery({
    queryKey: ['account'],
    queryFn: () => api.getAccount(),
    enabled: !!session?.data,
  });

  const { data: features } = useQuery({
    queryKey: ['features'],
    queryFn: () => api.getFeatures(),
    enabled: !!session?.data,
  });

  const { data: creditSummary } = useQuery<CreditSummaryResponse>({
    queryKey: ['creditSummary'],
    queryFn: () => api.getCreditSummary(),
    // Refresh every 30 s so the cap / balance stays reasonably fresh
    refetchInterval: 30_000,
    enabled: !!session?.data,
  });

  const { data: touStatusData, isLoading: touStatusLoading } = useQuery({
    queryKey: ['touStatus'],
    queryFn: () => api.getTouStatus(),
    enabled: !!session?.data,
  });

  useEffect(() => {
    setTouStatus(touStatusData ?? null);
  }, [touStatusData, setTouStatus]);

  useEffect(() => {
    if (account) setAccount(account);
  }, [account, setAccount]);

  useEffect(() => {
    if (features) setFeatures(features);
  }, [features, setFeatures]);

  useEffect(() => {
    setCreditSummary(creditSummary ?? null);
  }, [creditSummary, setCreditSummary]);

  if (session === undefined) {
    // TODO: Add a loading state
    return <div>Loading...</div>;
  }

  if (session?.data && touStatusLoading) {
    return <div>Loading...</div>;
  }

  if (
    session?.data &&
    touStatus &&
    !touStatus.accepted &&
    touStatus.currentVersion?.changeType === TouChangeType.Material
  ) {
    return (
      <TouAcceptanceInterstitial
        touStatus={touStatus}
        onAccepted={() =>
          queryClient.invalidateQueries({ queryKey: ['touStatus'] })
        }
      />
    );
  }

  return <>{children}</>;
};
