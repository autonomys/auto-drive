import { useConnectModal } from '@rainbow-me/rainbowkit';
import { useCallback, useEffect, useState } from 'react';
import { useAccount, useSignMessage } from 'wagmi';
import { getMessageToSign } from '../app/api/auth/[...nextauth]/web3';
import { signIn as nextAuthSignIn, signOut as nextAuthSignOut } from 'next-auth/react';
import { defaultNetworkId } from '@auto-drive/ui';
import { clearSessionCache } from '@/utils/auth';
import { useUserStore } from '@/globalStates/user';

export type AuthProvider = 'google' | 'discord' | 'web3-wallet' | 'github';

interface SignInOptions {
  /** Where to land after OAuth completes. Defaults to the default drive view. */
  callbackUrl?: string;
}

interface UseAuth {
  signIn: (provider: AuthProvider, options?: SignInOptions) => void;
}

export const useLogIn = (): UseAuth => {
  const { openConnectModal } = useConnectModal();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isClicked, setIsClicked] = useState<AuthProvider>();

  const signIn = useCallback(
    (provider: AuthProvider, options?: SignInOptions) => {
      setIsClicked(provider);
      if (provider === 'web3-wallet') {
        if (openConnectModal) openConnectModal();
      } else {
        nextAuthSignIn(provider, {
          callbackUrl: options?.callbackUrl ?? `/${defaultNetworkId}/drive`,
        });
      }
    },
    [openConnectModal],
  );

  const signInWithWallet = useCallback(async () => {
    if (!address) return;

    const message = await getMessageToSign(address);
    const signature = await signMessageAsync({
      message,
    });
    nextAuthSignIn('web3-wallet', {
      address,
      message,
      signature,
      redirect: true,
      callbackUrl: `/${defaultNetworkId}/drive`,
    });
  }, [address, signMessageAsync]);

  useEffect(() => {
    if (address && isClicked === 'web3-wallet') {
      signInWithWallet();
    }
  }, [address, signInWithWallet, isClicked]);

  return { signIn };
};

export const useLogOut = () => {
  const clearUser = useUserStore((state) => state.clearUser);

  const logOut = useCallback(() => {
    clearSessionCache();
    clearUser();
    nextAuthSignOut();
  }, [clearUser]);

  return { logOut };
};
