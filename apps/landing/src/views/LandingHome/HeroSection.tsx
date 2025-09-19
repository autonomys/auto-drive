import { Button, Card, AutonomysSymbol, EXTERNAL_ROUTES } from '@auto-drive/ui';
import { Globe, Wallet } from 'lucide-react';
import { SiGithub, SiGoogle, SiDiscord } from '@icons-pack/react-simple-icons';
import { useCallback } from 'react';

const HeroSection = () => {
  const signIn = useCallback((provider?: string) => {
    window.location.assign(EXTERNAL_ROUTES.fileExplorer(provider));
  }, []);

  return (
    <section className='relative bg-gradient-main py-24 lg:py-32'>
      <div className='container mx-auto px-4'>
        <div className='grid items-center gap-12 lg:grid-cols-2'>
          {/* Left Column - Main Content */}
          <div className='space-y-8'>
            <div className='space-y-4'>
              <h1 className='text-4xl font-bold tracking-tight lg:text-6xl'>
                Auto Drive
              </h1>
              <p className='max-w-lg text-xl text-muted-foreground'>
                Store, share, and download your files securely with Autonomys
                Network decentralized permanent storage.
              </p>
            </div>

            <div className='space-y-4'>
              <p className='text-sm font-medium text-muted-foreground'>
                Sign in with:
              </p>
              <div className='grid flex-1 grid-cols-2 gap-3 font-semibold'>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2'
                  onClick={() => signIn('google')}
                >
                  <SiGoogle size={16} />
                  <span>Google</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2'
                  onClick={() => signIn('discord')}
                >
                  <SiDiscord size={16} />
                  <span>Discord</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2'
                  onClick={() => signIn('github')}
                >
                  <SiGithub size={16} />
                  <span>Github</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2'
                  onClick={() => signIn('web3-wallet')}
                >
                  <Wallet size={16} />
                  <span>Wallet</span>
                </Button>
                <div className='col-span-2 flex items-center justify-start'>
                  <p className='text-sm font-medium text-muted-foreground'>
                    Or access as guest:
                  </p>
                </div>
                <Button
                  variant='primary'
                  className='col-span-2 flex items-center justify-start space-x-2'
                  onClick={() => signIn()}
                >
                  <Globe size={16} />
                  <span>Explore</span>
                </Button>
              </div>
            </div>
          </div>

          {/* Right Column - Demo Interface */}
          <div className='lg:ml-8'>
            <Card className='border-card-border bg-white p-6 text-black shadow-xl'>
              <div className='space-y-6'>
                <div className='flex items-center space-x-2'>
                  <AutonomysSymbol fill='currentColor' />
                  <span className='font-semibold'>Auto Drive</span>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center space-x-2 text-sm text-muted-foreground'>
                    <div className='h-4 w-4 rounded bg-muted opacity-0' />
                    <span>Files</span>
                  </div>
                  <div className='flex items-center space-x-2 text-sm text-muted-foreground'>
                    <div className='h-4 w-4' />
                    <span>Global Feed</span>
                  </div>
                  <div className='flex items-center space-x-2 text-sm text-muted-foreground'>
                    <div className='h-4 w-4' />
                    <span>Shared with me</span>
                  </div>
                </div>

                <div className='border-t pt-4'>
                  <div className='mb-3 text-xs text-muted-foreground'>
                    ROOT CID
                  </div>
                  <div className='space-y-2'>
                    <div className='flex items-center justify-between rounded bg-muted/30 p-2'>
                      <span className='font-mono text-xs'>document.pdf</span>
                      <span className='text-xs text-success'>ARCHIVED</span>
                    </div>
                    <div className='flex items-center justify-between rounded bg-muted/30 p-2'>
                      <span className='font-mono text-xs'>image.jpg</span>
                      <span className='text-xs text-success'>ARCHIVED</span>
                    </div>
                  </div>
                </div>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
