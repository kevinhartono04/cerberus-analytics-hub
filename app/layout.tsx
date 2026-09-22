import type { Metadata } from "next";
import { isRecoveryMode } from "@/lib/recovery-mode";

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
      <body>
        {isRecoveryMode() ? (
          <aside role="status" className="border-b border-amber-300 bg-amber-50 px-4 py-3 text-center text-sm text-amber-950">
            <strong>Recovery mode:</strong> Historical specs are temporarily unavailable. New work is saved.
            {" "}Automated alerts are paused. Dashboard settings use recovery defaults until reviewed by an administrator.
          </aside>
        ) : null}
        {children}
      </body>
    </html>
  );
}
