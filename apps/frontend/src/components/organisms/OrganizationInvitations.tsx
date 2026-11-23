'use client';

import { Fragment, useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Dialog,
  DialogPanel,
  DialogTitle,
  Transition,
  TransitionChild,
} from '@headlessui/react';
import {
  BannerCriticality,
  ReceivedOrganizationInvitation,
} from '@auto-drive/models';
import { Button, ROUTES } from '@auto-drive/ui';
import { useNetwork } from '@/contexts/network';
import { useUserStore } from '@/globalStates/user';
import { ApiError } from '@/services/api';
import { ROLE_LABEL } from '@/utils/organization';
import { BannerShell } from './BannerNotifications/BannerShell';

const QUERY_KEY = ['receivedOrganizationInvitations'];

const AcceptDialog = ({
  invitation,
  onClose,
}: {
  invitation: ReceivedOrganizationInvitation | null;
  onClose: () => void;
}) => {
  const { api, network } = useNetwork();
  // Set once the server says joining would strand purchased credits, so the
  // user confirms that too before trying again.
  const [leavesCredits, setLeavesCredits] = useState(false);

  const { mutate: accept, isPending } = useMutation({
    mutationFn: (args: { id: string; allowUnusedCredits: boolean }) =>
      api.acceptInvitation(args.id, args.allowUnusedCredits),
    onSuccess: () => {
      // Joining changes the account behind every page, so start afresh.
      window.location.assign(ROUTES.organization(network.id));
    },
    onError: (error: Error) => {
      if (
        error instanceof ApiError &&
        error.code === 'UNUSED_PURCHASED_CREDITS'
      ) {
        setLeavesCredits(true);
        return;
      }
      toast.error(error.message);
    },
  });

  const close = () => {
    if (isPending) return;
    setLeavesCredits(false);
    onClose();
  };

  const name = invitation?.organizationName ?? '';

  return (
    <Transition appear show={invitation !== null} as={Fragment}>
      <Dialog as='div' className='relative z-50' onClose={close}>
        <TransitionChild
          as={Fragment}
          enter='ease-out duration-200'
          enterFrom='opacity-0'
          enterTo='opacity-100'
          leave='ease-in duration-150'
          leaveFrom='opacity-100'
          leaveTo='opacity-0'
        >
          <div className='fixed inset-0 bg-black/25' />
        </TransitionChild>
        <div className='fixed inset-0 overflow-y-auto'>
          <div className='flex min-h-full items-center justify-center p-4'>
            <DialogPanel className='w-full max-w-md rounded-2xl bg-background p-6 text-left shadow-xl'>
              <DialogTitle as='h3' className='text-lg font-medium'>
                Join {name}?
              </DialogTitle>
              <ul className='mt-3 list-inside list-disc space-y-1 text-sm text-muted-foreground'>
                <li>
                  Your uploads, in the web app and with your own API keys, use{' '}
                  {name}&apos;s credits from now on.
                </li>
                <li>
                  Its members see your Public ID and role, and its usage reports
                  include your uploads and your API keys&apos; names.
                </li>
                <li>Your files stay yours.</li>
                <li>
                  An admin of {name} can remove you, which returns you to your
                  personal account.
                </li>
              </ul>
              {leavesCredits && (
                <p className='mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200'>
                  Your personal account still has purchased credits. They stay
                  there and keep expiring on schedule, and you can&apos;t use
                  them while you are in {name}.
                </p>
              )}
              <div className='mt-6 flex justify-end gap-2'>
                <Button variant='outline' onClick={close} disabled={isPending}>
                  Cancel
                </Button>
                <Button
                  variant='primary'
                  disabled={isPending || !invitation}
                  onClick={() =>
                    invitation &&
                    accept({
                      id: invitation.id,
                      allowUnusedCredits: leavesCredits,
                    })
                  }
                >
                  {isPending
                    ? 'Joining…'
                    : leavesCredits
                      ? 'Join anyway'
                      : `Join ${name}`}
                </Button>
              </div>
            </DialogPanel>
          </div>
        </div>
      </Dialog>
    </Transition>
  );
};

/** Invitations to join a partner organization, for the signed-in user. */
export const OrganizationInvitations = () => {
  const { api } = useNetwork();
  const queryClient = useQueryClient();
  const isSignedIn = useUserStore((state) => !!state.user);
  const [accepting, setAccepting] =
    useState<ReceivedOrganizationInvitation | null>(null);

  const { data: invitations } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: () => api.getReceivedInvitations(),
    enabled: isSignedIn,
    staleTime: 5 * 60_000,
  });

  const { mutate: decline, isPending: isDeclining } = useMutation({
    mutationFn: (id: string) => api.declineInvitation(id),
    onSuccess: () => {
      toast.success('Invitation declined');
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!isSignedIn || !invitations?.length) return null;

  return (
    <>
      {invitations.map((invitation) => (
        <BannerShell key={invitation.id} criticality={BannerCriticality.Info}>
          <div className='flex flex-wrap items-center justify-between gap-3'>
            <p className='text-sm'>
              You&apos;re invited to join{' '}
              <strong>{invitation.organizationName}</strong> as{' '}
              {ROLE_LABEL[invitation.role].toLowerCase()}.
            </p>
            <div className='flex gap-2'>
              <Button
                variant='outline'
                size='sm'
                disabled={isDeclining}
                onClick={() => decline(invitation.id)}
              >
                Decline
              </Button>
              <Button
                variant='primary'
                size='sm'
                onClick={() => setAccepting(invitation)}
              >
                Review and join
              </Button>
            </div>
          </div>
        </BannerShell>
      ))}
      <AcceptDialog invitation={accepting} onClose={() => setAccepting(null)} />
    </>
  );
};
