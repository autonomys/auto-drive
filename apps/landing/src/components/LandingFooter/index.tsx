import { Linkedin } from 'lucide-react';
import {
  SiGithub,
  SiDiscord,
  SiYoutube,
  SiX,
  SiTelegram,
} from '@icons-pack/react-simple-icons';
import { EXTERNAL_ROUTES, AutonomysSymbol } from '@auto-drive/ui';

const currentYear = new Date().getFullYear();

const LandingFooter = () => {
  return (
    <footer className='bg-background-hover py-16 text-foreground'>
      <div className='container mx-auto px-4'>
        <div className='grid gap-8 md:grid-cols-4'>
          {/* Brand */}
          <div className='space-y-4'>
            <div className='flex items-center space-x-2'>
              <AutonomysSymbol />
              <span className='text-xl font-bold'>Auto Drive</span>
            </div>
            <p className='text-foreground-hover text-sm'>
              © {currentYear} Autonomys Labs, Inc. All Rights Reserved
            </p>
          </div>

          {/* Links */}
          <div className='space-y-4'>
            <h3 className='font-semibold'>Links</h3>
            <div className='space-y-2 text-sm'>
              <a
                href={EXTERNAL_ROUTES.academy}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Academy
              </a>
              <a
                href={EXTERNAL_ROUTES.forum}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Forum
              </a>
              <a
                href={EXTERNAL_ROUTES.docs}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Docs
              </a>
              <a
                href={EXTERNAL_ROUTES.autonomys}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Website
              </a>
            </div>
          </div>

          {/* Social */}
          <div className='space-y-4'>
            <h3 className='font-semibold'>Social</h3>
            <div className='space-y-2 text-sm'>
              <a
                href={EXTERNAL_ROUTES.social.twitter}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                X / Twitter
              </a>
              <a
                href={EXTERNAL_ROUTES.social.discord}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Discord
              </a>
              <a
                href={EXTERNAL_ROUTES.social.telegram}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Telegram
              </a>
              <a
                href={EXTERNAL_ROUTES.social.github}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                GitHub
              </a>
              <a
                href={EXTERNAL_ROUTES.social.medium}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                Medium
              </a>
              <a
                href={EXTERNAL_ROUTES.social.youtube}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                YouTube
              </a>
              <a
                href={EXTERNAL_ROUTES.social.linkedin}
                target='_blank'
                rel='noreferrer'
                className='block transition-colors hover:text-primary'
              >
                LinkedIn
              </a>
            </div>
          </div>

          {/* Social Icons */}
          <div className='space-y-4'>
            <h3 className='font-semibold'>Connect</h3>
            <div className='flex space-x-3'>
              <a
                href={EXTERNAL_ROUTES.social.twitter}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <SiX className='h-4 w-4' />
              </a>
              <a
                href={EXTERNAL_ROUTES.social.discord}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <SiDiscord className='h-4 w-4' />
              </a>
              <a
                href={EXTERNAL_ROUTES.social.telegram}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <SiTelegram className='h-4 w-4' />
              </a>
              <a
                href={EXTERNAL_ROUTES.social.github}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <SiGithub className='h-4 w-4' />
              </a>
              <a
                href={EXTERNAL_ROUTES.social.youtube}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <SiYoutube className='h-4 w-4' />
              </a>
              <a
                href={EXTERNAL_ROUTES.social.linkedin}
                target='_blank'
                rel='noreferrer'
                className='flex h-8 w-8 items-center justify-center rounded bg-background/10 transition-colors hover:bg-background/20'
              >
                <Linkedin className='h-4 w-4' />
              </a>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default LandingFooter;
