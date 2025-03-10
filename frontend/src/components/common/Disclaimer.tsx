export const Disclaimer = () => {
  return (
    <div className='dark:text-darkBlack relative rounded-lg border border-red-300 bg-red-50 bg-opacity-60 p-4 dark:bg-red-400'>
      <h3 className='mb-2 font-semibold'>Please, note:</h3>
      <ul className='list-inside list-disc space-y-1 text-sm font-bold'>
        <li>Uploaded content will be visible and searchable by everyone</li>
        <li>Anyone can download your files</li>
        <li>
          Files are stored on Autonomy&apos;s network so they can&apos;t be
          deleted by anyone
        </li>
        <li>Storage is permanent and irreversible</li>
        <li>Encryption is available but the encrypted file will be public</li>
      </ul>
    </div>
  );
};
