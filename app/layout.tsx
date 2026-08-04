import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Cerberus Analytics Hub",
  description: "Generate and review game analytics specs from a reusable reference library.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script
          id="cerberus-theme"
          dangerouslySetInnerHTML={{
            __html: `try {
              var theme = localStorage.getItem("cerberus-theme");
              document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
            } catch (_) {
              document.documentElement.dataset.theme = "dark";
            }`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
