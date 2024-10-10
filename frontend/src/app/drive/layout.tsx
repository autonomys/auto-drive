import { ScopeSwitch } from "@/components/common/ScopeSwitch";
import { SearchBar } from "@/components/SearchBar";
import {
  GlobeIcon,
  HomeIcon,
  ShareIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import { InternalLink } from "../../components/common/InternalLink";
import "../globals.css";

export default function AppLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-white px-8">
      <div className="flex h-screen flex-col bg-white rounded-lg p-6">
        <header className="flex flex-col md:flex-row gap-4 md:gap-0 items-center justify-between mb-8">
          <div className="flex items-center space-x-2">
            <img
              src="/autonomys.png"
              alt="Auto Drive"
              className="w-[2rem] h-[2rem] rounded-full"
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
        <div className="flex flex-1 overflow-hidden">
          <aside className="w-16 md:w-64 space-y-4">
            <InternalLink href="/drive">
              <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
                <HomeIcon className="w-5 h-5" />
                <span className="hidden md:block">Files</span>
              </button>
            </InternalLink>
            <button
              disabled={true}
              className="flex items-center space-x-2 text-gray-700 opacity-50"
            >
              <ShareIcon className="w-5 h-5" />
              <span className="hidden md:block">Shared</span>
            </button>
            <button
              disabled={true}
              className="flex items-center space-x-2 text-gray-700 opacity-50"
            >
              <TrashIcon className="w-5 h-5" />
              <span className="hidden md:block">Trash</span>
            </button>
            <button
              disabled={true}
              className="flex items-center space-x-2 text-gray-700 opacity-50"
            >
              <GlobeIcon className="w-5 h-5" />
              <span className="hidden md:block">Global feed</span>
            </button>
          </aside>
          <main className="flex-1 overflow-auto p-6">{children}</main>
        </div>
        <footer className="mt-8 flex justify-start">
          <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
            <UserIcon className="w-5 h-5" />
            <span className="hidden md:block">User</span>
          </button>
        </footer>
      </div>
    </div>
  );
}
