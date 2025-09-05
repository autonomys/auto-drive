'use client';

import { LandingLayout } from '@/components/LandingLayout';
import { CTASection } from './CTASection';
import { DeveloperSection } from './DeveloperSection';
import HeroSection from './HeroSection';
import { UploadSection } from './UploadSection';

export const LandingHome = () => {
  return (
    <LandingLayout>
      <HeroSection />
      <UploadSection />
      <DeveloperSection />
      <CTASection />
    </LandingLayout>
  );
};
