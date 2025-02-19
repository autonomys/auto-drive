import { EXTERNAL_ROUTES } from 'constants/routes';
import type { FC } from 'react';
import { currentYear } from 'utils/time';
import { LogoIcon } from 'components/common/LogoIcon';

const Footer: FC = () => {
  return (
    <footer className='container mb-[50px] px-4 sm:mx-auto xl:px-0'>
      <div className='body-font rounded-xl bg-backgroundDarker p-10 text-white dark:bg-darkBlack dark:bg-darkWhiteHover dark:text-whiteOpaque'>
        <div className='md:grid md:grid-cols-2'>
          <div className='mb-20 flex justify-center md:mb-0 md:justify-start'>
            <div className='flex flex-col md:justify-between'>
              <div className='shrink-0 text-center md:mx-0 md:text-left'>
                <LogoIcon fillColor='white' />
              </div>
              <div className='container mx-auto hidden flex-col flex-wrap pb-1 pr-5 pt-20 sm:flex sm:flex-row'>
                <p className='text-center text-xs text-whiteOpaque sm:text-left'>
                  © {currentYear()} Autonomys Labs, Inc. All Rights Reserved
                </p>
              </div>
            </div>
          </div>
          <div className='grid grid-cols-1 gap-8 sm:grid-cols-2 sm:gap-6'>
            <div>
              <h2 className='title-font mb-6 text-xs font-semibold uppercase text-white'>
                Links:
              </h2>
              <ul className='text-whiteOpaque dark:text-gray-400'>
                <li key='academy' className='mb-4'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.academy}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Academy
                  </a>
                </li>
                <li key='forum' className='mb-4'>
                  <a
                    href={EXTERNAL_ROUTES.forum}
                    target='_blank'
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Forum
                  </a>
                </li>
                <li key='docs' className='mb-4'>
                  <a
                    href={EXTERNAL_ROUTES.docs}
                    target='_blank'
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Docs
                  </a>
                </li>
                <li key='autonomys'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.autonomys}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Website
                  </a>
                </li>
              </ul>
            </div>
            <div className='grid grid-cols-2 gap-x-6'>
              <h2 className='title-font col-span-2 mb-6 text-xs font-semibold uppercase text-white'>
                Social:
              </h2>
              <ul className='space-y-4 text-gray-600 dark:text-gray-400'>
                <li key='twitter'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.twitter}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    X / Twitter
                  </a>
                </li>
                <li key='discord'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.discord}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Discord
                  </a>
                </li>
                <li key='telegram'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.telegram}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Telegram
                  </a>
                </li>
                <li key='github'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.github}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    GitHub
                  </a>
                </li>
              </ul>
              <ul className='space-y-4 text-gray-600 dark:text-gray-400'>
                <li key='medium'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.medium}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    Medium
                  </a>
                </li>
                <li key='youtube'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.youtube}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    YouTube
                  </a>
                </li>
                <li key='linkedin'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.linkedin}
                    className='hover:text-primaryAccent text-xs text-whiteOpaque'
                    rel='noreferrer'
                  >
                    LinkedIn
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>
        <div className='container mx-auto flex flex-col flex-wrap pb-1 pr-5 pt-20 sm:hidden sm:flex-row'>
          <p className='text-center text-sm text-whiteOpaque sm:text-left'>
            © {currentYear()} Autonomys Network, Inc. All Rights Reserved
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
