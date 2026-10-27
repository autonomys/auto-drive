'use client';

import { Button } from '@auto-drive/ui';
import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';

export const WalletConnection = ({
  isBusy = false,
  connectedMessage = 'Wallet connected',
}: {
  isBusy?: boolean;
  connectedMessage?: string;
}) => {
  const { address, connector, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect, isPending, error } = useDisconnect();

  return (
    <div className='flex flex-col gap-3 rounded-md bg-muted p-4'>
      <div className='flex flex-wrap items-center justify-between gap-3'>
        <div className='min-w-0'>
          <div className='text-sm font-medium'>Wallet Connection</div>
          <div className='text-xs text-muted-foreground'>
            {isConnected
              ? connectedMessage
              : 'Please connect your wallet to continue'}
          </div>
          {isConnected && (
            <div className='mt-1 flex flex-col gap-1'>
              {connector?.name && (
                <span className='text-xs text-muted-foreground'>
                  {connector.name}
                </span>
              )}
              <span className='break-all text-xs font-semibold text-green-700 dark:text-green-400'>
                {address}
              </span>
            </div>
          )}
        </div>
        {isConnected ? (
          <Button
            type='button'
            variant='outline'
            onClick={() => disconnect({ connector })}
            disabled={isBusy || isPending}
          >
            {isPending ? 'Disconnecting…' : 'Disconnect Wallet'}
          </Button>
        ) : (
          <Button
            type='button'
            onClick={() => openConnectModal?.()}
            disabled={isBusy || isPending || !openConnectModal}
          >
            Connect Wallet
          </Button>
        )}
      </div>
      {isConnected && error && (
        <p role='alert' className='text-xs text-red-600'>
          Could not disconnect your wallet. Please try again.
        </p>
      )}
    </div>
  );
};
