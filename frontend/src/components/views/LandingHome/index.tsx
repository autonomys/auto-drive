'use client';

import LandingFooter from '../../molecules/LandingFooter';
import { LandingHeader } from '../../molecules/LandingHeader';
import { CTASection } from './CTASection';
import { DeveloperSection } from './DeveloperSection';
import HeroSection from './HeroSection';
import { UploadSection } from './UploadSection';

export const LandingHome = () => {
  return (
    <div className='flex min-h-screen flex-col'>
      <LandingHeader />
      <HeroSection />
      <UploadSection />
      <DeveloperSection />
      <CTASection />
      <LandingFooter />
    </div>
  );
};
