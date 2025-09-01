import Footer from '@/components/molecules/Footer';
import { FAQ } from './questions';

export const FAQs = () => {
  return (
    <div
      className={
        'flex min-h-screen flex-col items-center justify-between bg-gradient-to-b from-backgroundLight to-backgroundDark dark:from-backgroundDark dark:to-backgroundDarkest'
      }
    >
      <FAQ />
      <Footer />
    </div>
  );
};
