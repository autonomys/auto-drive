import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { UploadPopover } from "../components/UploadPopover";
import { Button } from "../components/common/Button";
import { FolderRoot, HelpCircle, Network } from "lucide-react";
import { SearchBar } from "../components/SearchBar";

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
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <div className="flex h-screen flex-col">
          <header className="flex items-center justify-between border-b px-6 py-3">
            <div className="flex items-center">
              <div className="text-center w-[13.5rem]">
                <h1 className="text-2xl font-bold">Auto-Drive</h1>
              </div>
              <div className="w-80">
                <SearchBar />
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <Button variant="outline">
                <HelpCircle className="h-5 w-5" />
              </Button>
            </div>
          </header>
          <div className="flex flex-1 overflow-hidden">
            <aside className="flex flex-col gap-4 w-60 border-r p-4">
              <UploadPopover />
              <a className="contents" href="/">
                <Button
                  variant="outline"
                  className="w-full gap-2 flex items-center justify-start"
                >
                  <FolderRoot className="h-5 w-5" />
                  My Drive
                </Button>
              </a>
              <a className="contents" href="/explorer">
                <Button
                  variant="outline"
                  className="w-full gap-2 flex items-center justify-start"
                >
                  <Network className="h-5 w-5" />
                  Node Explorer
                </Button>
              </a>
            </aside>
            <main className="flex-1 overflow-auto p-6">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
