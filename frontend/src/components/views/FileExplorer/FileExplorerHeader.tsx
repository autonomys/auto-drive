export const FileExplorerHeader = () => {
  return (
    <div className='border-b'>
      <div className='container mx-auto px-4 py-6'>
        <div className='text-center'>
          <h1 className='text-3xl font-bold'>Auto Drive Explorer</h1>
          <div className='bg-muted/50 mt-3 inline-flex items-center rounded-full border px-3 py-1'>
            <span className='text-muted-foreground text-sm font-medium'>
              Browse and search files stored on Autonomys Network
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};
