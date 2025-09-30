import { Button, ROUTES } from '@auto-drive/ui';
import { InternalLink } from './InternalLink';
import { useNetwork } from '../../contexts/network';

export const BuyMoreCreditsButton = () => {
  const { network } = useNetwork();

  return (
    <InternalLink href={ROUTES.purchase(network.id)} className='contents'>
      <Button variant='outline' size='sm' className='w-full text-xs'>
        Buy more credits
      </Button>
    </InternalLink>
  );
};
