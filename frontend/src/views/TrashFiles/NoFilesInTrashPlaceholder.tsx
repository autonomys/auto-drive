export const NoFilesInTrashPlaceholder = () => {
  return (
    <div className='dark:bg-darkWhite mx-auto max-w-2xl rounded-lg bg-white p-6'>
      <h2 className='mb-4 text-center text-2xl font-bold'>No files in trash</h2>
      <p className='mb-6 text-center'>Files you remove will appear here.</p>
    </div>
  );
};
