import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Meeting commitments",
  description: "Upload a short two-person recording and get the final agreed tasks, each with a playable quote.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
