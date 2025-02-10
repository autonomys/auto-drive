import { InternalLink } from '../common/InternalLink';

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
      className={`dark:hover:text-darkPrimary mb-2 flex items-center space-x-2 text-black hover:text-blue-600 ${isActive ? 'text-darkPrimary' : 'dark:text-darkBlack'}`}
    >
      <Icon className='h-5 w-5' />
      <span className='hidden md:block'>{label}</span>
    </button>
  </InternalLink>
);
