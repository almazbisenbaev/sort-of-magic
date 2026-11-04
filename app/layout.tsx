import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Sort of Magic', description: 'Clean CSV files and Excel worksheets with AI suggestions you can review, apply, and undo.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
