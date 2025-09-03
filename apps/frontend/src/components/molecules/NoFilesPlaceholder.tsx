import { File } from 'lucide-react';

export const NoFilesPlaceholder = () => {
  return (
    <div className='py-12 text-center'>
      <File className='text-muted-foreground mx-auto mb-4 h-12 w-12' />
      <h3 className='mb-2 text-lg font-medium'>No files found</h3>
      <p className='text-muted-foreground'>Try adjusting your search terms.</p>
    </div>
  );
};
