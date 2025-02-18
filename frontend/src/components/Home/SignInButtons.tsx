import { signIn } from 'next-auth/react';
import { useCallback, useState } from 'react';
import { DiscordIcon } from 'components/common/DiscordIcon';
import { GoogleIcon } from 'components/common/GoogleIcon';
import { GithubIcon } from 'components/common/GithubIcon';
import { BuiltInProviderType } from 'next-auth/providers';
import { LoaderCircle } from 'lucide-react';

export const SigningInButtons = () => {
  const [isClicked, setIsClicked] = useState<BuiltInProviderType>();

  const handleGoogleAuth = useCallback(() => {
    setIsClicked('google');
    signIn('google');
  }, []);
  const handleDiscordAuth = useCallback(() => {
    setIsClicked('discord');
    signIn('discord');
  }, []);

  const handleGithubAuth = useCallback(() => {
    setIsClicked('github');
    signIn('github');
  }, []);

  return (
    <div className='flex flex-col gap-2'>
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
    </div>
  );
};
