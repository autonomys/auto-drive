import { useAutomaticLogin } from '@/hooks/useAutomaticLogin';

export const AutomaticLoginWrapper = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  useAutomaticLogin();

  return <>{children}</>;
};
