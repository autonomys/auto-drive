import { AutonomysSymbol, EXTERNAL_ROUTES, Button } from '@auto-drive/ui';
import { Globe } from 'lucide-react';
import Link from 'next/link';

export const LandingHeader = () => {
  return (
    <header className='sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60'>
      <div className='mx-auto flex h-16 w-full max-w-screen-2xl items-center justify-between px-4 md:px-6'>
        <Link href='/'>
          <div className='flex items-center space-x-2'>
            <AutonomysSymbol />
            <span className='text-xl font-bold'>Auto Drive</span>
          </div>
        </Link>

        <Link href={EXTERNAL_ROUTES.fileExplorer()}>
          <Button className='flex items-center justify-start space-x-2 font-bold'>
            <Globe size={16} />
            Explore
          </Button>
        </Link>
      </div>
    </header>
  );
};
