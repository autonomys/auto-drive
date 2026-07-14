'use client';

import { useFilesToBeReviewedQuery } from '../../../../gql/graphql';
import { useNetwork } from '../../../contexts/network';
import { Button, ROUTES } from '@auto-drive/ui';
import { AlertTriangle } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '../../../globalStates/user';
import { isAdminUser } from '@auto-drive/models';

// This filter (reported, not banned, not dismissed) mirrors the "Needs Review"
// section on the reported-files page, so the count here matches what an admin
// would actually need to act on there.
const REVIEW_LIMIT = 200;

/**
 * Admin-only alert shown above the file lists linking to the reported-files
 * review page. It is a shortcut to the dedicated page (drive/admin/reported)
 * rather than an inline manager, so the count and the queue never diverge.
 */
export const ToBeReviewedFiles = () => {
  const { network } = useNetwork();
  const router = useRouter();
  const { user } = useUserStore();
  const isAdmin = !!user && isAdminUser(user);

  const { data } = useFilesToBeReviewedQuery({
    variables: { limit: REVIEW_LIMIT, offset: 0 },
    fetchPolicy: 'cache-and-network',
    skip: !isAdmin,
  });

  const count = data?.metadata_aggregate?.aggregate?.count ?? 0;

  if (!isAdmin || count === 0) {
    return null;
  }

  return (
    <div>
      <Button
        variant='danger'
        className='flex items-center gap-1 text-sm font-medium'
        onClick={() => router.push(ROUTES.adminReported(network.id))}
      >
        <AlertTriangle className='h-4 w-4' />
        Files to be reviewed ({count})
      </Button>
    </div>
  );
};
