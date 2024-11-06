export const NoFilesInTrashPlaceholder = () => {
  return (
    <div className='mx-auto max-w-2xl rounded-lg bg-white p-6'>
      <h2 className='mb-4 text-center text-2xl font-bold'>No files in trash</h2>
      <p className='mb-6 text-center'>
        Files you mark as deleted will appear here.
      </p>
    </div>
  );
};
