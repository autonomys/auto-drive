import { useQuery } from '@tanstack/react-query';
import { OrganizationOverview } from '@auto-drive/models';
import { useNetwork } from '@/contexts/network';
import { useUserStore } from '@/globalStates/user';

export const organizationOverviewKey = (
  networkId: string,
  organizationId: string | null,
) => ['organizationOverview', networkId, organizationId];

/**
 * The signed-in user's partner organization. `organizationId` is null until
 * the account has loaded, and for users outside a partner organization.
 */
export const useOrganization = () => {
  const account = useUserStore((state) => state.account);
  const { api, network } = useNetwork();
  const organizationId = account?.isPartner ? account.organizationId : null;

  const query = useQuery<OrganizationOverview>({
    queryKey: organizationOverviewKey(network.id, organizationId),
    queryFn: () => api.getOrganizationOverview(organizationId!),
    enabled: organizationId !== null,
    staleTime: 60_000,
  });

  return {
    organizationId,
    accountLoaded: account !== null,
    overview: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
