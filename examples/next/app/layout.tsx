import { IconavoProvider, loadIcons } from "@iconavo-ui/react";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import "./iconavo";
import names from "./icons.json";

export const metadata: Metadata = { title: "Iconavo with Next.js" };

// A Server Component: the icons known in advance are loaded here and passed to IconavoProvider, so
// they are drawn in the server HTML and don't flash. Other icons load in the browser.
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const icons = await loadIcons(names.server);
  return (
    <html lang="en">
      <body>
        <IconavoProvider icons={icons}>{children}</IconavoProvider>
      </body>
    </html>
  );
}
