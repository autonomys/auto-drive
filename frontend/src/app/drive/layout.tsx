"use client";

import { ScopeSwitch } from "@/components/common/ScopeSwitch";
import { SearchBar } from "@/components/SearchBar";
import {
  HomeIcon,
  SettingsIcon,
  TrashIcon,
  UserIcon,
  UsersIcon,
} from "lucide-react";
import { InternalLink } from "../../components/common/InternalLink";
import "../globals.css";
import { UserEnsurer } from "../../components/UserEnsurer";
import { RoleProtected } from "../../components/RoleProtected";
import { UserRole } from "../../models/User";
import { RemainingCreditTracker } from "../../components/RemainingCreditTracker";
import { useMemo } from "react";
import { useUserStore } from "../../states/user";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { subscription } = useUserStore();

  const startDate = useMemo(() => {
    const date = new Date();
    return new Date(date.getFullYear(), date.getMonth(), 1).toLocaleDateString(
      "en-US",
      {
        month: "short",
        day: "numeric",
        year: "numeric",
      }
    );
  }, []);

  const endDate = useMemo(() => {
    const date = new Date();
    return new Date(
      date.getFullYear(),
      date.getMonth() + 1,
      1
    ).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  }, []);

  return (
    <div className="min-h-screen bg-white">
      <div className="flex h-screen flex-col bg-white rounded-lg">
        <header className="flex flex-col w-full md:flex-row gap-4 md:gap-0 items-center justify-between mb-8 px-10 py-2 border-b-[0.2px] border-[#000000]">
          <div className="flex items-center space-x-2">
            <img
              src="/autonomys.png"
              alt="Auto Drive"
              className="w-[1rem] h-[1rem] rounded-full"
            />
            <span className="text-xl font-semibold">Auto Drive</span>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm font-medium">Your Files</span>
            <ScopeSwitch />
            <span className="text-sm font-medium">Global</span>
            <div className="md:w-80">
              <SearchBar />
            </div>
          </div>
        </header>
        <div className="flex flex-1 overflow-hidden px-10">
          <UserEnsurer>
            <aside className="w-12 md:w-48">
              <InternalLink className="contents" href="/drive">
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600 mb-2">
                  <HomeIcon className="w-5 h-5" />
                  <span className="hidden md:block">Files</span>
                </button>
              </InternalLink>
              <InternalLink className="contents" href="/drive/shared">
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600 mb-2">
                  <UsersIcon className="w-5 h-5" />
                  <span className="hidden md:block">Shared with me</span>
                </button>
              </InternalLink>
              <InternalLink className="contents" href="/drive/trash">
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600 mb-2">
                  <TrashIcon className="w-5 h-5" />
                  <span className="hidden md:block">Trash</span>
                </button>
              </InternalLink>
              <RoleProtected roles={[UserRole.Admin]}>
                <InternalLink className="contents" href="/drive/admin">
                  <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600 mb-2">
                    <SettingsIcon className="w-5 h-5" />
                    <span className="hidden md:block">Admin</span>
                  </button>
                </InternalLink>
              </RoleProtected>
              {subscription && (
                <RemainingCreditTracker
                  uploadPending={subscription.pendingUploadCredits}
                  uploadLimit={subscription.uploadLimit}
                  downloadPending={subscription.pendingDownloadCredits}
                  downloadLimit={subscription.downloadLimit}
                  startDate={startDate}
                  endDate={endDate}
                />
              )}
            </aside>
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </UserEnsurer>
        </div>
        <footer className="mt-8 flex justify-start w-16 md:w-64 flex-col gap-2 px-10 py-2">
          <div className="flex">
            <InternalLink href="/drive/profile">
              <button className="flex space-x-2 text-gray-700 hover:text-blue-600">
                <UserIcon className="w-5 h-5" />
                <span className="hidden md:block">User</span>
              </button>
            </InternalLink>
          </div>
        </footer>
      </div>
    </div>
  );
}
