import { Disclaimer } from '@/components/atoms/Disclaimer';

export const NoUploadsPlaceholder = () => {
  return (
    <div className='mx-auto max-w-2xl rounded-lg bg-background p-6'>
      <h2 className='mb-4 text-center text-2xl font-bold text-foreground'>
        Make your first upload
      </h2>
      <p className='text-foreground-hover mb-6 text-center'>
        Use it as regular cloud storage, but with the guarantee
        <br></br>
        that your data will never be lost.
      </p>
      <Disclaimer />
    </div>
  );
};
