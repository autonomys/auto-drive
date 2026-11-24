import {
  Earth,
  TrashIcon,
  UsersIcon,
  HomeIcon,
  UserIcon,
  CodeXmlIcon,
  SettingsIcon,
  MegaphoneIcon,
  FileTextIcon,
  UserXIcon,
  FlagIcon,
  ChartColumnIcon,
  Building2Icon,
  FolderIcon,
  KeyRoundIcon,
} from 'lucide-react';
import { NetworkId, ROUTES } from '@auto-drive/ui';
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
    // Everything about the partner organization a user belongs to.
    label: 'Organization',
    onlyPartner: true,
    items: [
      {
        href: (networkId: NetworkId) => ROUTES.organization(networkId),
        icon: Building2Icon,
        label: 'Overview',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.organizationFiles(networkId),
        icon: FolderIcon,
        label: 'Files',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.organizationUsage(networkId),
        icon: ChartColumnIcon,
        label: 'Usage',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.organizationApiKeys(networkId),
        icon: KeyRoundIcon,
        label: 'API keys',
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
      {
        href: (networkId: NetworkId) => ROUTES.adminBanners(networkId),
        icon: MegaphoneIcon,
        label: 'Banners',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.adminTou(networkId),
        icon: FileTextIcon,
        label: 'Terms of Use',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.adminDeletions(networkId),
        icon: UserXIcon,
        label: 'Deletions',
        requiresSession: true,
      },
      {
        href: (networkId: NetworkId) => ROUTES.adminReported(networkId),
        icon: FlagIcon,
        label: 'Reported Files',
        requiresSession: true,
      },
    ],
  },
];
