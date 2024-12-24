import { EXTERNAL_ROUTES } from '../../constants/routes';
import type { FC } from 'react';
import { currentYear } from '../../utils/time';

const Footer: FC = () => {
  return (
    <footer className='container mb-[50px] px-4 sm:mx-auto xl:px-0'>
      <div className='body-font bg-backgroundDarker dark:bg-backgroundDark rounded-xl p-10 text-white'>
        <div className='md:grid md:grid-cols-2'>
          <div className='mb-20 flex justify-center md:mb-0 md:justify-start'>
            <div className='flex flex-col md:justify-between'>
              <div className='shrink-0 text-center md:mx-0 md:text-left'></div>
              <div className='container mx-auto hidden flex-col flex-wrap pb-1 pr-5 pt-20 sm:flex sm:flex-row'>
                <p className='text-whiteOpaque text-center text-xs sm:text-left'>
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
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Academy
                  </a>
                </li>
                <li key='forum' className='mb-4'>
                  <a
                    href={EXTERNAL_ROUTES.forum}
                    target='_blank'
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Forum
                  </a>
                </li>
                <li key='docs' className='mb-4'>
                  <a
                    href={EXTERNAL_ROUTES.docs}
                    target='_blank'
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Docs
                  </a>
                </li>
                <li key='autonomys'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.autonomys}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
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
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    X / Twitter
                  </a>
                </li>
                <li key='discord'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.discord}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Discord
                  </a>
                </li>
                <li key='telegram'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.telegram}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Telegram
                  </a>
                </li>
                <li key='github'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.github}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
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
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    Medium
                  </a>
                </li>
                <li key='youtube'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.youtube}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
                    rel='noreferrer'
                  >
                    YouTube
                  </a>
                </li>
                <li key='linkedin'>
                  <a
                    target='_blank'
                    href={EXTERNAL_ROUTES.social.linkedin}
                    className='text-whiteOpaque hover:text-primaryAccent text-xs'
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
          <p className='text-whiteOpaque text-center text-sm sm:text-left'>
            © {currentYear()} Autonomys Network, Inc. All Rights Reserved
          </p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
