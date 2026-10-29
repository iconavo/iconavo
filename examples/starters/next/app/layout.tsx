import { IconavoProvider, loadIcons } from "@iconavo-ui/react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = { title: "Iconavo with Next.js" };

// A Server Component: the icons above the fold load here and go to IconavoProvider, so they are in
// the server HTML and don't flash. Other icons load in the browser.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const icons = await loadIcons([
    "lucide:house",
    "lucide:search",
    "lucide:settings",
    "lucide:heart",
  ]);
  return (
    <html lang="en">
      <body>
        <IconavoProvider icons={icons}>{children}</IconavoProvider>
      </body>
    </html>
  );
}
