import type { Metadata } from "next";
import "@fontsource-variable/manrope";
import "@fontsource-variable/geist-mono";
import { AppShell } from "@/components/layout/app-shell";
import "./globals.css";
import "./clips.css";
import "./planning.css";

export const metadata: Metadata = {
  title: { default: "Overview | ClipFlow", template: "%s | ClipFlow" },
  description: "ClipFlow is your local workspace for short video publishing.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body><AppShell>{children}</AppShell></body>
    </html>
  );
}
