export const NoSharedFilesPlaceholder = () => {
  return (
    <div className='bg-background-hover mx-auto max-w-2xl rounded-lg p-6'>
      <h2 className='text-background-hovers-foreground mb-4 text-center text-2xl font-bold'>
        No files have been shared with you yet
      </h2>
      <p className='text-foreground-hover mb-6 text-center'>
        Share files with others by clicking the share button on any of your
        files.
      </p>
    </div>
  );
};
