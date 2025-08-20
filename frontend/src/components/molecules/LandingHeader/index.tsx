import { Button } from '@/components/atoms/Button';
import { AutonomysSymbol } from '../../icons/AutonomysSymbol';
import { useState } from 'react';
import { AuthModal } from '@/components/molecules/AuthModal';
import { defaultNetworkId } from '../../../constants/networks';
import { ROUTES } from '../../../constants/routes';

export const LandingHeader = () => {
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  return (
    <header className='bg-background/95 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50 w-full border-b backdrop-blur'>
      <div className='mx-auto flex h-16 w-full max-w-screen-2xl items-center justify-between px-4 md:px-6'>
        <a href='/'>
          <div className='flex items-center space-x-2'>
            <AutonomysSymbol />
            <span className='text-xl font-bold'>Auto Drive</span>
          </div>
        </a>

        <nav className='hidden items-center space-x-6 md:flex'>
          <a
            href='/'
            className='text-sm font-medium transition-colors hover:text-primary'
          >
            Home
          </a>
          <a
            href={ROUTES.explorer(defaultNetworkId)}
            className='text-sm font-medium transition-colors hover:text-primary'
          >
            Explorer
          </a>

          <a
            href='https://develop.autonomys.xyz/sdk/auto-drive/overview_setup'
            target='_blank'
            rel='noopener noreferrer'
            className='text-sm font-medium transition-colors hover:text-primary'
          >
            Docs
          </a>
        </nav>

        <Button className='font-bold' onClick={() => setIsAuthModalOpen(true)}>
          Get Started
        </Button>

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      </div>
    </header>
  );
};
