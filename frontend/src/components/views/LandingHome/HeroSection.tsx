import { Button } from '@/components/atoms/Button';
import { Globe, Wallet } from 'lucide-react';
import { Card } from '../../atoms/Card';
import { AutonomysSymbol } from '../../icons/AutonomysSymbol';
import { SiGithub, SiGoogle, SiDiscord } from '@icons-pack/react-simple-icons';
import { useLogIn } from '@/hooks/useAuth';
import { ROUTES } from '../../../constants/routes';
import { defaultNetworkId } from '../../../constants/networks';
import { NavItem } from '../../atoms/NavItem';
import { InternalLink } from '../../atoms/InternalLink';

const HeroSection = () => {
  const { signIn } = useLogIn();

  return (
    <section className='bg-gradient-main relative py-24 lg:py-32'>
      <div className='container mx-auto px-4'>
        <div className='grid items-center gap-12 lg:grid-cols-2'>
          {/* Left Column - Main Content */}
          <div className='space-y-8'>
            <div className='space-y-4'>
              <h1 className='text-4xl font-bold tracking-tight lg:text-6xl'>
                Auto Drive
              </h1>
              <p className='text-muted-foreground max-w-lg text-xl'>
                Store, share, and download your files securely with Autonomys
                Network decentralized permanent storage.
              </p>
            </div>

            <div className='space-y-4'>
              <p className='text-muted-foreground text-sm font-medium'>
                Sign in with:
              </p>
              <div className='grid flex-1 grid-cols-2 gap-3 font-semibold'>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2 text-[#000000]'
                  onClick={() => signIn('google')}
                >
                  <SiGoogle size={16} />
                  <span>Google</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2 text-[#000000]'
                  onClick={() => signIn('discord')}
                >
                  <SiDiscord size={16} />
                  <span>Discord</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2 text-[#000000]'
                  onClick={() => signIn('github')}
                >
                  <SiGithub size={16} />
                  <span>Github</span>
                </Button>
                <Button
                  variant='outline'
                  className='flex items-center justify-start space-x-2 text-[#000000]'
                  onClick={() => signIn('web3-wallet')}
                >
                  <Wallet size={16} />
                  <span>Wallet</span>
                </Button>
                <div className='col-span-2 flex items-center justify-start'>
                  <p className='text-muted-foreground text-sm font-medium'>
                    Or access as guest:
                  </p>
                </div>
                <InternalLink href={ROUTES.globalFeed(defaultNetworkId)}>
                  <Button
                    variant='primary'
                    className='col-span-2 flex items-center justify-start space-x-2'
                  >
                    <Globe size={16} />
                    <span>Explore</span>
                  </Button>
                </InternalLink>
              </div>
            </div>
          </div>

          {/* Right Column - Demo Interface */}
          <div className='lg:ml-8'>
            <Card className='bg-gradient-card border-card-border p-6 shadow-xl'>
              <div className='space-y-6'>
                <div className='flex items-center space-x-2'>
                  <AutonomysSymbol />
                  <span className='font-semibold'>Auto Drive</span>
                </div>

                <div className='space-y-4'>
                  <div className='flex items-center space-x-2 text-sm'>
                    <div className='bg-muted h-4 w-4 rounded' />
                    <span>Files</span>
                  </div>
                  <div className='text-muted-foreground flex items-center space-x-2 text-sm'>
                    <div className='h-4 w-4' />
                    <span>Global Feed</span>
                  </div>
                  <div className='text-muted-foreground flex items-center space-x-2 text-sm'>
                    <div className='h-4 w-4' />
                    <span>Shared with me</span>
                  </div>
                </div>

                <div className='border-t pt-4'>
                  <div className='text-muted-foreground mb-3 text-xs'>
                    ROOT CID
                  </div>
                  <div className='space-y-2'>
                    <div className='bg-muted/30 flex items-center justify-between rounded p-2'>
                      <span className='font-mono text-xs'>document.pdf</span>
                      <span className='text-success text-xs'>ARCHIVED</span>
                    </div>
                    <div className='bg-muted/30 flex items-center justify-between rounded p-2'>
                      <span className='font-mono text-xs'>image.jpg</span>
                      <span className='text-success text-xs'>ARCHIVED</span>
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
