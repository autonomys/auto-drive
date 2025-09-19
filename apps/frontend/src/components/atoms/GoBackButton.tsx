import { ChevronLeftIcon } from 'lucide-react';
import { Button } from '@auto-drive/ui';
import { useRouter } from 'next/navigation';

export const GoBackButton = ({
  children = 'Back',
  onClick,
}: {
  children?: React.ReactNode;
  onClick?: () => void;
}) => {
  const router = useRouter();

  return (
    <Button
      variant='outline'
      size='sm'
      className='inline-flex items-center'
      onClick={onClick ? onClick : router.back}
    >
      <ChevronLeftIcon className='h-4 w-4' />
      {children}
    </Button>
  );
};
