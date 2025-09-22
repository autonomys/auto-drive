import { ChevronLeftIcon } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import { useRouter } from 'next/navigation';

/* eslint-disable react/prop-types */
export const GoBackButton: React.FC<{ children?: string }> = ({
  children = 'Back',
}) => {
  const router = useRouter();

  return (
    <Button
      variant='outline'
      size='sm'
      className='inline-flex items-center'
      onClick={() => router.back()}
    >
      <ChevronLeftIcon className='h-4 w-4' />
      {children}
    </Button>
  );
};
