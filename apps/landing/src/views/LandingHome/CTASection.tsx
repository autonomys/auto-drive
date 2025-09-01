import { Button, Card } from '@auto-drive/ui';
import Link from 'next/link';

export const CTASection = () => {
  return (
    <>
      <section className='bg-background py-24'>
        <div className='container mx-auto px-4'>
          <Card className='bg-gradient-hero p-12 text-center text-white shadow-xl'>
            <div className='space-y-8'>
              <div className='space-y-4'>
                <h2 className='text-3xl font-bold lg:text-5xl'>
                  Join Us Today and Experience the Future of Storage!
                </h2>
                <p className='mx-auto max-w-2xl text-xl text-white/90'>
                  Sign in now to store, share, and download your files securely
                  with Autonomys Network decentralized permanent storage.
                </p>
              </div>

              <div className='space-y-6'>
                <Link href='https://explorer.ai3.storage'>
                  <Button
                    variant='secondary'
                    size='lg'
                    className='px-8 py-3 text-lg'
                  >
                    Sign In Now
                  </Button>
                </Link>
              </div>
            </div>
          </Card>
        </div>
      </section>
    </>
  );
};
