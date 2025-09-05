import { EXTERNAL_ROUTES, Button } from '@auto-drive/ui';

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
