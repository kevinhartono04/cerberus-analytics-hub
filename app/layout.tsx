import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "CEREBRAL | Cerberus Analytics",
  description: "Design, validate, and monitor game analytics with Cerberus Analytics.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          id="cerebral-theme"
          dangerouslySetInnerHTML={{
            __html: `try {
              var theme = localStorage.getItem("cerberus-theme");
              document.documentElement.dataset.theme = theme === "dark" ? "dark" : "light";
            } catch (_) {
              document.documentElement.dataset.theme = "light";
            }`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
