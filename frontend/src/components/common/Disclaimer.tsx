export const Disclaimer = () => {
  return (
    <div className='relative rounded-lg border border-red-300 bg-red-50 bg-opacity-60 p-4'>
      <h3 className='mb-2 font-semibold'>Please, note:</h3>
      <ul className='list-inside list-disc space-y-1 text-sm'>
        <li>Files at this stage cannot be encrypted</li>
        <li>Uploaded content will be visible and searchable by everyone</li>
        <li>Anyone can download your files</li>
        <li>Storage is permanent and irreversible</li>
        <li>
          Your uploads & downloads are limitted to <strong>100MB</strong> and{' '}
          <strong>5GB</strong> monthly respectively
        </li>
      </ul>
    </div>
  );
};
