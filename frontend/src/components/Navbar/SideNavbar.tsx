import { NetworkId } from 'constants/networks';
import { ROUTES } from 'constants/routes';
import {
  CodeXmlIcon,
  Earth,
  HomeIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from 'lucide-react';
import React, { useMemo } from 'react';
import { RoleProtected } from 'components/RoleProtected';
import { UserRole } from '@auto-drive/models';
import dayjs from 'dayjs';
import { AccountInformation } from '@/components/AccountInformation';
import { useUserStore } from 'globalStates/user';
import { usePathname } from 'next/navigation';
import { NavItem } from './NavItem';

export const NAV_ITEMS = [
  {
    href: (networkId: NetworkId) => ROUTES.drive(networkId),
    icon: HomeIcon,
    label: 'Files',
  },
  {
    href: (networkId: NetworkId) => ROUTES.globalFeed(networkId),
    icon: Earth,
    label: 'Global Feed',
  },
  {
    href: (networkId: NetworkId) => ROUTES.shared(networkId),
    icon: UsersIcon,
    label: 'Shared with me',
  },
  {
    href: (networkId: NetworkId) => ROUTES.trash(networkId),
    icon: TrashIcon,
    label: 'Trash',
  },
  {
    href: (networkId: NetworkId) => ROUTES.developers(networkId),
    icon: CodeXmlIcon,
    label: 'Developers',
  },
  {
    href: (networkId: NetworkId) => ROUTES.profile(networkId),
    icon: UserIcon,
    label: 'Profile',
  },
];

export const ADMIN_ITEM = {
  href: (networkId: NetworkId) => ROUTES.admin(networkId),
  icon: SettingsIcon,
  label: 'Admin',
};

export type SideNavbarProps = {
  networkId: NetworkId;
};

export const SideNavbar = ({ networkId }: SideNavbarProps) => {
  const pathname = usePathname();
  const subscription = useUserStore(({ subscription }) => subscription);

  const renewalDate = useMemo(() => {
    const date = dayjs().add(1, 'month').startOf('month');
    return date.toDate();
  }, []);

  return (
    <aside className='w-12 md:w-48'>
      {NAV_ITEMS.map(({ href, icon, label }) => (
        <NavItem
          key={label}
          href={href(networkId)}
          icon={icon}
          label={label}
          isActive={pathname === href(networkId)}
        />
      ))}
      <RoleProtected roles={[UserRole.Admin]}>
        <NavItem
          href={ADMIN_ITEM.href(networkId)}
          icon={ADMIN_ITEM.icon}
          label={ADMIN_ITEM.label}
          isActive={pathname === ADMIN_ITEM.href(networkId)}
        />
      </RoleProtected>
      {subscription && (
        <AccountInformation
          uploadPending={subscription.pendingUploadCredits}
          uploadLimit={subscription.uploadLimit}
          downloadPending={subscription.pendingDownloadCredits}
          downloadLimit={subscription.downloadLimit}
          renewalDate={renewalDate}
        />
      )}
    </aside>
  );
};
