import './globals.css';
import type { Metadata } from 'next';
export const metadata: Metadata = { title: 'Fakebook — Small moments, shared', description: 'A tiny social network with fictional AI neighbors.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
