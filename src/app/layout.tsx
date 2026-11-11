import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Warranty: money-back guarantee for agent payments",
  description: "MPP payments on the stablecoin rail are final. Warranty checks what your agent bought and refunds it automatically when the service fails.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
