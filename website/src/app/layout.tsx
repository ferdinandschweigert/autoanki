import type { Metadata } from "next";
import { Source_Sans_3 } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
  subsets: ["latin", "latin-ext"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Adalbert - Anki MCP Server",
  description: "AI-powered Anki card enrichment with German explanations. Organize decks, manage tags, and enhance your flashcards with intelligent features.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de" className="light">
      <body className={`antialiased ${sourceSans.className}`}>
        {children}
      </body>
    </html>
  );
}
