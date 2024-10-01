import { ScopeSwitch } from "@/components/common/ScopeSwitch";
import { SearchBar } from "@/components/SearchBar";
import { Switch } from "@headlessui/react";
import {
  GlobeIcon,
  HomeIcon,
  ShareIcon,
  TrashIcon,
  UserIcon,
} from "lucide-react";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { useLocalStorage } from "usehooks-ts";
import "../globals.css";

const geistSans = localFont({
  src: "../fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "../fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
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
                <a href="/drive" className="contents">
                  <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
                    <HomeIcon className="w-5 h-5" />
                    <span className="hidden md:block">Files</span>
                  </button>
                </a>
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
                  <ShareIcon className="w-5 h-5" />
                  <span className="hidden md:block">Shared</span>
                </button>
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
                  <TrashIcon className="w-5 h-5" />
                  <span className="hidden md:block">Trash</span>
                </button>
                <button className="flex items-center space-x-2 text-gray-700 hover:text-blue-600">
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
      </body>
    </html>
  );
}
