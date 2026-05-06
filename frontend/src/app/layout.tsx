import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Campus Chat",
  description: "Realtime college chat app with Google login"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
