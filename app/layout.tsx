import type { Metadata, Viewport } from "next";
import { Plus_Jakarta_Sans, Fraunces } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/shadcn/sonner";
import { brand } from "@/packs/shared";
import { brandCss } from "@/packs/theme";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], variable: "--font-jakarta" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", style: ["normal", "italic"] });

// The page's name, icon and colours come from the active niche pack (docs/PACKS.md).
const b = brand();
export const metadata: Metadata = { title: b.name, description: b.description, icons: { icon: b.assets.icon } };
export const viewport: Viewport = {
  themeColor: [{ media: "(prefers-color-scheme: light)", color: b.colors.themeColor.light }, { media: "(prefers-color-scheme: dark)", color: b.colors.themeColor.dark }],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${jakarta.variable} ${fraunces.variable}`}>
      <head>
        {/* the pack's colour tokens (our own constant data, no user input) */}
        <style id="pack-theme" dangerouslySetInnerHTML={{ __html: brandCss(b.colors) }} />
      </head>
      <body>
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          {children}
          <Toaster position="top-center" richColors closeButton />
        </ThemeProvider>
      </body>
    </html>
  );
}
