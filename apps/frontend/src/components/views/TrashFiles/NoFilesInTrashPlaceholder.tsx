export const NoFilesInTrashPlaceholder = () => {
  return (
    <div className='bg-background-hover mx-auto max-w-2xl rounded-lg p-6'>
      <h2 className='text-background-hovers-foreground mb-4 text-center text-2xl font-bold'>
        No files in trash
      </h2>
      <p className='text-foreground-hover mb-6 text-center'>
        Files you remove will appear here.
      </p>
    </div>
  );
};
