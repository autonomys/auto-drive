import { Card } from '@/components/atoms/Card';
import { Button } from '@/components/atoms/Button';
import { Code, Key, GitBranch } from 'lucide-react';

export const DeveloperSection = () => {
  return (
    <section id='api' className='bg-gradient-main py-24'>
      <div className='container mx-auto px-4'>
        <div className='mb-16 text-center'>
          <h2 className='mb-4 text-3xl font-bold lg:text-5xl'>
            Seamless Integration & Developer-Friendly
          </h2>
          <p className='text-muted-foreground mx-auto max-w-3xl text-xl'>
            Build with Auto Drive&apos;s powerful APIs and SDKs
          </p>
        </div>

        <div className='grid gap-12 lg:grid-cols-2'>
          {/* API Support */}
          <Card className='bg-gradient-card p-8 shadow-xl'>
            <div className='space-y-6'>
              <div className='flex items-center space-x-3'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10'>
                  <Key className='h-5 w-5 text-primary' />
                </div>
                <h3 className='text-2xl font-bold'>API Support</h3>
              </div>

              <p className='text-muted-foreground'>
                Create API keys to access Autonomys Network decentralized
                permanent storage, through our API or our TypeScript SDK.
              </p>

              <div className='space-y-4'>
                <h4 className='font-semibold'>Create API Keys</h4>
                <div className='bg-muted/50 rounded-lg p-4'>
                  <div className='flex items-center justify-between'>
                    <span className='font-mono text-sm'>
                      API Key Management
                    </span>
                    <Button size='sm' variant='outline'>
                      Generate
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </Card>

          {/* TypeScript SDK */}
          <Card className='bg-gradient-card p-8 shadow-xl'>
            <div className='space-y-6'>
              <div className='flex items-center space-x-3'>
                <div className='flex h-10 w-10 items-center justify-center rounded-lg bg-accent/10'>
                  <Code className='h-5 w-5 text-accent' />
                </div>
                <h3 className='text-2xl font-bold'>
                  TypeScript & JavaScript Support
                </h3>
              </div>

              <p className='text-muted-foreground'>
                Implement Auto-Drive&apos;s powerful permanent decentralized
                storage capabilities into your own applications using our
                official NPM package.
              </p>

              <div className='space-y-4'>
                <h4 className='font-semibold'>@autonomys/auto-drive</h4>
                <div className='bg-foreground/5 rounded-lg p-4 font-mono text-sm'>
                  <div className='space-y-1'>
                    <div>npm install auto-drive</div>
                    <div>yarn add auto-drive</div>
                  </div>
                </div>
                <p className='text-muted-foreground text-sm'>
                  Get started quickly with a familiar JavaScript/TypeScript
                  interface and comprehensive documentation.
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Auto-DAG Section */}
        <div className='mt-16'>
          <Card className='bg-gradient-card p-8 shadow-xl'>
            <div className='grid items-center gap-8 lg:grid-cols-2'>
              <div className='space-y-6'>
                <div className='flex items-center space-x-3'>
                  <div className='bg-auto-drive-secondary/10 flex h-10 w-10 items-center justify-center rounded-lg'>
                    <GitBranch className='text-auto-drive-secondary h-5 w-5' />
                  </div>
                  <h3 className='text-2xl font-bold'>
                    Scalable Data Structure for Decentralized Storage
                  </h3>
                </div>

                <div className='space-y-4'>
                  <h4 className='text-xl font-semibold'>
                    Auto-DAG Data Structure
                  </h4>
                  <p className='text-muted-foreground'>
                    Autonomys Network uses the Auto-DAG data structure, which
                    stores your data on chain in small chunks to fit the block
                    size limit of Autonomys Network and to ensure the integrity
                    and authenticity of your data.
                  </p>
                </div>
              </div>

              <div className='flex justify-center'>
                <div className='relative'>
                  <div className='bg-gradient-hero/10 flex h-48 w-64 items-center justify-center rounded-lg border-2 border-dashed border-primary/30'>
                    <div className='space-y-2 text-center'>
                      <GitBranch className='mx-auto h-16 w-16 text-primary/50' />
                      <p className='text-muted-foreground text-sm'>
                        Auto-DAG Structure
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>
    </section>
  );
};
