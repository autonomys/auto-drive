import { NetworkId } from '@auto-drive/ui';
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarGroupContent,
  SidebarMenu,
  SidebarGroup,
  SidebarGroupLabel,
} from '@/components/molecules/Sidebar';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '../../../utils/cn';
import { LockIcon } from 'lucide-react';

type SidebarItem = {
  href: (networkId: NetworkId) => string;
  icon: React.ElementType;
  label: string;
  requiresSession?: boolean;
};

export type SidebarSection = {
  label: string;
  onlyAdmin?: boolean;
  items: SidebarItem[];
};

export const SideNavBarContent = ({
  sidebarItems,
  handleOpenAuthModal,
  networkId,
  isLoggedIn,
  collapsed,
}: {
  sidebarItems: SidebarSection[];
  handleOpenAuthModal: () => void;
  networkId: NetworkId;
  isLoggedIn: boolean;
  collapsed: boolean;
}) => {
  const router = useRouter();
  const pathname = usePathname();

  return Object.values(sidebarItems).map((definition) => (
    <SidebarGroup key={definition.label}>
      <SidebarGroupLabel>{definition.label}</SidebarGroupLabel>

      <SidebarGroupContent>
        <SidebarMenu>
          {definition.items.map((item) => {
            const isNotLoggedInAndRequiresSession =
              !isLoggedIn && item.requiresSession;

            const onClick = isNotLoggedInAndRequiresSession
              ? handleOpenAuthModal
              : () => router.push(item.href(networkId));

            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  isActive={pathname === item.href(networkId)}
                  onClick={onClick}
                  className={cn(
                    'group relative',
                    isNotLoggedInAndRequiresSession &&
                      'cursor-not-allowed opacity-50',
                  )}
                  tooltip={collapsed ? item.label : undefined}
                >
                  <item.icon className='h-4 w-4' />
                  <span className='flex-1'>{item.label}</span>
                  {isNotLoggedInAndRequiresSession && (
                    <SidebarMenuBadge>
                      <LockIcon className='h-4 w-4' />
                    </SidebarMenuBadge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  ));
};
