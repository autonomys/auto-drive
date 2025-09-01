import { ChevronLeftIcon } from 'lucide-react';
import { Button } from '@/components/atoms/Button';
import { useRouter } from 'next/navigation';

export const GoBackButton = ({
  children = 'Back',
}: {
  children?: React.ReactNode;
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
