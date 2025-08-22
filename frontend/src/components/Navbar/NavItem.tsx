import { InternalLink } from 'components/common/InternalLink';

export type NavItemProps = {
  href: string;
  icon: React.ElementType;
  label: string;
  isActive: boolean;
};

export const NavItem = ({
  href,
  icon: Icon,
  label,
  isActive,
}: NavItemProps) => (
  <InternalLink className='contents' href={href}>
    <button
      className={`mb-2 flex items-center space-x-2 text-foreground hover:text-blue-600 dark:hover:text-darkPrimary ${isActive ? 'text-darkPrimary' : 'text-foreground'}`}
    >
      <Icon className='h-5 w-5' />
      <span className='hidden md:block'>{label}</span>
    </button>
  </InternalLink>
);
