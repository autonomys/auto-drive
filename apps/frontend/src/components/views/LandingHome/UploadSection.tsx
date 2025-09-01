import { Upload, Shield, Clock } from 'lucide-react';
import { Card } from '../../atoms/Card';

export const UploadSection = () => {
  return (
    <section className='bg-background py-24'>
      <div className='container mx-auto px-4'>
        <div className='mb-16 text-center'>
          <h2 className='mb-4 text-3xl font-bold lg:text-5xl'>
            Upload Once, Access Forever.
          </h2>
          <p className='text-muted-foreground mx-auto max-w-3xl text-xl'>
            Your Drive into Permanent Decentralized Storage.
          </p>
        </div>

        <div className='grid items-center gap-12 lg:grid-cols-2'>
          {/* Upload Demo */}
          <div className='order-2 lg:order-1'>
            <Card className='bg-gradient-card p-8 shadow-lg'>
              <div className='border-muted space-y-4 rounded-lg border-2 border-dashed p-12 text-center'>
                <Upload className='text-muted-foreground mx-auto h-12 w-12' />
                <div>
                  <p className='font-medium'>
                    Add or drop files / folders here
                  </p>
                  <p className='text-muted-foreground text-sm'>
                    Or select files and folders from your computer
                  </p>
                </div>
              </div>

              <div className='mt-6 space-y-3'>
                <h3 className='font-semibold'>Upload Files & Folders</h3>
                <p className='text-muted-foreground text-sm'>
                  Upload files and folders to Autonomys Network decentralized
                  permanent storage, by simply dragging and dropping them into
                  the upload area. Or select files and folders from your
                  computer.
                </p>
              </div>
            </Card>
          </div>

          {/* Features */}
          <div className='order-1 space-y-8 lg:order-2'>
            <div className='flex items-start space-x-4'>
              <div className='flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10'>
                <Shield className='h-6 w-6 text-primary' />
              </div>
              <div>
                <h3 className='mb-2 text-xl font-semibold'>
                  Secure End-to-End Encryption (E2EE)
                </h3>
                <p className='text-muted-foreground'>
                  Secure your data with optional end-to-end encryption on
                  Autonomys Network. Choose between setting a global encryption
                  key for all files, customizing keys per file, or uploading
                  without encryption - putting you in complete control of your
                  data security.
                </p>
                <p className='mt-2 text-sm font-medium text-primary'>
                  Upload with encryption or without
                </p>
              </div>
            </div>

            <div className='flex items-start space-x-4'>
              <div className='flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-accent/10'>
                <Clock className='h-6 w-6 text-accent' />
              </div>
              <div>
                <h3 className='mb-2 text-xl font-semibold'>
                  Permanent Storage
                </h3>
                <p className='text-muted-foreground'>
                  Your files are stored permanently on the Autonomys Network,
                  ensuring they remain accessible and intact for generations to
                  come. No subscription fees, no recurring costs - just
                  permanent, decentralized storage.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
