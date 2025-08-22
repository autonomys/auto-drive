import {
  Earth,
  TrashIcon,
  UsersIcon,
  HomeIcon,
  UserIcon,
  CodeXmlIcon,
  SettingsIcon,
} from 'lucide-react';
import { NetworkId } from '../../../constants/networks';
import { ROUTES } from '../../../constants/routes';
import { SidebarSection } from './SideNavBarContent';

export const SIDEBAR_DEFINITION: SidebarSection[] = [
  {
    label: 'Explore',
    items: [
      {
        href: (networkId: NetworkId) => ROUTES.globalFeed(networkId),
        icon: Earth,
        label: 'File explorer',
      },
    ],
  },
  {
    label: 'Files',
    items: [
      {
        href: (networkId: NetworkId) => ROUTES.drive(networkId),
        icon: HomeIcon,
        label: 'My Files',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.shared(networkId),
        icon: UsersIcon,
        label: 'Shared with me',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.trash(networkId),
        icon: TrashIcon,
        label: 'Trash',
        requiresSession: true,
      },
    ],
  },
  {
    label: 'Account',
    items: [
      {
        href: (networkId: NetworkId) => ROUTES.profile(networkId),
        icon: UserIcon,
        label: 'Profile',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.developers(networkId),
        icon: CodeXmlIcon,
        label: 'Developers',
        requiresSession: true,
      },
    ],
  },
  {
    label: 'Admin',
    onlyAdmin: true,
    items: [
      {
        href: (networkId: NetworkId) => ROUTES.admin(networkId),
        icon: SettingsIcon,
        label: 'Admin',
        requiresSession: true,
      },
    ],
  },
];
