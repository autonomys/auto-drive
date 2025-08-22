import { Disclaimer } from 'components/common/Disclaimer';

export const NoUploadsPlaceholder = () => {
  return (
    <div className='mx-auto max-w-2xl rounded-lg bg-background p-6 bg-background'>
      <h2 className='mb-4 text-center text-2xl font-bold'>
        Make your first upload
      </h2>
      <p className='mb-6 text-center'>
        Use it as regular cloud storage, but with the guarantee
        <br></br>
        that your data will never be lost.
      </p>
      <Disclaimer />
    </div>
  );
};
