import { EXTERNAL_ROUTES } from '../../constants/routes';
import { Button } from './Button';

export const AskForCreditsButton = () => {
  return (
    <a
      target='_blank'
      rel='noreferrer'
      href={EXTERNAL_ROUTES.requestMoreCreditsForm}
      className='contents'
    >
      <Button variant='outline' size='sm' className='w-full text-xs'>
        Ask for more credits
      </Button>
    </a>
  );
};
