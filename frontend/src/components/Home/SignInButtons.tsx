import { useConnectModal } from '@rainbow-me/rainbowkit';
import { LoaderCircle } from 'lucide-react';
import { BuiltInProviderType } from 'next-auth/providers';
import { signIn } from 'next-auth/react';
import { useCallback, useEffect, useState } from 'react';
import { DiscordIcon } from 'components/common/DiscordIcon';
import { GoogleIcon } from 'components/common/GoogleIcon';
import { useAccount, useSignMessage } from 'wagmi';
import { WalletIcon } from '../../components/common/WalletIcon';
import { GithubIcon } from '../../components/common/GithubIcon';
import { getMessageToSign } from '../../app/api/auth/[...nextauth]/web3';

export const SigningInButtons = () => {
  const { openConnectModal } = useConnectModal();
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const [isClicked, setIsClicked] = useState<
    BuiltInProviderType | 'web3-wallet'
  >();

  const handleGoogleAuth = useCallback(() => {
    setIsClicked('google');
    signIn('google');
  }, []);
  const handleDiscordAuth = useCallback(() => {
    setIsClicked('discord');
    signIn('discord');
  }, []);
  const handleAutoEVM = useCallback(async () => {
    setIsClicked('web3-wallet');
    if (openConnectModal) openConnectModal();
  }, [openConnectModal]);

  const signInWithWallet = useCallback(async () => {
    if (!address) return;

    const message = await getMessageToSign(address);
    const signature = await signMessageAsync({
      message,
    });
    signIn('web3-wallet', {
      address,
      message,
      signature,
      redirect: true,
      callbackUrl: '/drive',
    });
  }, [address, signMessageAsync]);

  useEffect(() => {
    if (address && isClicked === 'web3-wallet') {
      signInWithWallet();
    }
  }, [address, signInWithWallet, isClicked]);

  const handleGithubAuth = useCallback(() => {
    setIsClicked('github');
    signIn('github');
  }, []);

  return (
    <div className='flex flex-col gap-2 py-2'>
      <button
        onClick={handleGoogleAuth}
        className='flex w-full max-w-xs transform items-center justify-center gap-2 rounded-full border-2 border-backgroundDarker bg-white px-6 py-3 font-bold text-backgroundDarker transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 dark:border-darkBlack dark:bg-darkWhite dark:text-darkBlack'
        aria-label='Sign in with Google'
      >
        <GoogleIcon />
        Sign in with Google
        {isClicked === 'google' && <LoaderCircle className='animate-spin' />}
      </button>
      <button
        onClick={handleDiscordAuth}
        className='flex w-full max-w-xs transform items-center justify-center gap-2 rounded-full border-2 border-backgroundDarker bg-white px-6 py-3 font-bold text-backgroundDarker transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 dark:border-darkBlack dark:bg-darkWhite dark:text-darkBlack'
        aria-label='Sign in with Discord'
      >
        <DiscordIcon fillColor='#5865F2' />
        Sign in with Discord
        {isClicked === 'discord' && <LoaderCircle className='animate-spin' />}
      </button>
      <button
        onClick={handleGithubAuth}
        className='flex w-full max-w-xs transform items-center justify-center gap-2 rounded-full border-2 border-backgroundDarker bg-white px-6 py-3 font-bold text-backgroundDarker transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2 dark:border-darkBlack dark:bg-darkWhite dark:text-darkBlack'
        aria-label='Sign in with Github'
      >
        <GithubIcon fillColor='currentColor' />
        Sign in with Github
        {isClicked === 'github' && <LoaderCircle className='animate-spin' />}
      </button>
      <button
        onClick={handleAutoEVM}
        className='flex w-full max-w-xs transform items-center justify-center rounded-full border-2 border-backgroundDarker bg-white px-6 py-3 font-bold text-backgroundDarker transition duration-300 ease-in-out hover:-translate-y-1 hover:scale-105 hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-gray-900 focus:ring-offset-2'
        aria-label='Sign in with Wallet'
      >
        <WalletIcon />
        Sign in with Wallet
        {isClicked === 'web3-wallet' && (
          <LoaderCircle className='animate-spin' />
        )}
      </button>
    </div>
  );
};
