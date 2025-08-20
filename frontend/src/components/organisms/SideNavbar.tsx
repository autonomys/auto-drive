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
import { usePathname, useRouter } from 'next/navigation';
import {
  SidebarGroupContent,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenuItem,
  SidebarMenu,
  SidebarHeader,
  Sidebar,
  SidebarContent,
  SidebarFooter,
  useSidebar,
} from '../molecules/Sidebar';
import { useUserStore } from '../../globalStates/user';
import { UserRole } from '@auto-drive/models';
import { AutonomysSymbol } from '../icons/AutonomysSymbol';
import { AccountInformation } from '../molecules/AccountInformation';
import dayjs from 'dayjs';

const FILES_ITEMS = [
  {
    href: (networkId: NetworkId) => ROUTES.drive(networkId),
    icon: HomeIcon,
    label: 'My Files',
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
];

const ACCOUNT_ITEMS = [
  {
    href: (networkId: NetworkId) => ROUTES.profile(networkId),
    icon: UserIcon,
    label: 'Profile',
  },
  {
    href: (networkId: NetworkId) => ROUTES.developers(networkId),
    icon: CodeXmlIcon,
    label: 'Developers',
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
  const { user, subscription } = useUserStore();
  const pathname = usePathname();
  const { state } = useSidebar();
  const router = useRouter();

  const isAdmin = user?.role === UserRole.Admin;

  const collapsed = state === 'collapsed';

  const renewalDate = useMemo(() => {
    const date = dayjs().add(1, 'month').startOf('month');
    return date.toDate();
  }, []);

  return (
    <Sidebar className='bg-card border-r'>
      <SidebarHeader className='p-4'>
        <div className='flex items-center space-x-2'>
          <AutonomysSymbol />
          {!collapsed && (
            <div>
              <h2 className='text-sm font-semibold'>Auto Drive</h2>
              <p className='text-muted-foreground text-xs'>Permanent Storage</p>
            </div>
          )}
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Main Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Files</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {FILES_ITEMS.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={pathname === item.href(networkId)}
                    onClick={() => router.push(item.href(networkId))}
                    className='group relative'
                    tooltip={collapsed ? item.label : undefined}
                  >
                    <item.icon className='h-4 w-4' />
                    <span className='flex-1'>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {/* Developer Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Account</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {ACCOUNT_ITEMS.map((item) => (
                <SidebarMenuItem key={item.label}>
                  <SidebarMenuButton
                    isActive={pathname === item.href(networkId)}
                    onClick={() => router.push(item.href(networkId))}
                    tooltip={collapsed ? item.label : undefined}
                  >
                    <item.icon className='h-4 w-4' />
                    <span className='flex-1'>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {isAdmin && (
          <SidebarGroup>
            <SidebarGroupLabel>Admin</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    isActive={pathname === ADMIN_ITEM.href(networkId)}
                    onClick={() => router.push(ADMIN_ITEM.href(networkId))}
                    tooltip={collapsed ? ADMIN_ITEM.label : undefined}
                  >
                    <ADMIN_ITEM.icon className='h-4 w-4' />
                    <span className='flex-1'>{ADMIN_ITEM.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      <SidebarFooter className='p-4'>
        <AccountInformation
          renewalDate={renewalDate}
          uploadLimit={subscription?.uploadLimit ?? 0}
          uploadPending={subscription?.pendingUploadCredits ?? 0}
        />
      </SidebarFooter>
    </Sidebar>
  );
};
