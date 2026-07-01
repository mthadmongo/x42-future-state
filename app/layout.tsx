import type { ReactNode } from "react";
import "./globals.css";

export const metadata = {
  title: "x42 Healthcare Agent",
  description: "Patient chatbot for claims, prescriptions, and coverage — powered by MongoDB.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="app-shell">
          <header className="app-header">
            <span className="logo">x42</span>
            <span className="title">Healthcare Patient Agent</span>
          </header>
          <main>{children}</main>
        </div>
      </body>
    </html>
  );
}
