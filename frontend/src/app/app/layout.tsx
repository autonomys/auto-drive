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
import { SearchBar } from "../../components/SearchBar";
import "../globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Auto-Drive",
  description: "Autonomys Drive",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const [enabled, setEnabled] = [false, (b: boolean) => {}];

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
                <span className="text-sm font-medium">Global</span>
                <Switch
                  checked={enabled}
                  className={`${
                    enabled ? "bg-blue-600" : "bg-gray-200"
                  } relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2`}
                >
                  <span
                    className={`${
                      enabled ? "translate-x-6" : "translate-x-1"
                    } inline-block h-4 w-4 transform rounded-full bg-white transition-transform`}
                  />
                </Switch>
                <span className="text-sm font-medium">Your Files</span>
                <div className="md:w-80">
                  <SearchBar />
                </div>
              </div>
            </header>
            <div className="flex flex-1 overflow-hidden">
              <aside className="w-16 md:w-64 space-y-4">
                <a href="/app" className="contents">
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
