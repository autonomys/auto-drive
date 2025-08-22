import { Button } from '@/components/atoms/Button';
import { AutonomysSymbol } from '../../icons/AutonomysSymbol';
import { useState } from 'react';
import { AuthModal } from '@/components/molecules/AuthModal';
import { Globe } from 'lucide-react';
import { defaultNetworkId } from '../../../constants/networks';

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

        <Button
          className='flex items-center justify-start space-x-2 font-bold'
          onClick={() =>
            (window.location.href = `/${defaultNetworkId}/drive/global`)
          }
        >
          <Globe size={16} />
          Explore
        </Button>

        <AuthModal
          isOpen={isAuthModalOpen}
          onClose={() => setIsAuthModalOpen(false)}
        />
      </div>
    </header>
  );
};
