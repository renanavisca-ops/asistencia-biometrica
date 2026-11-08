import './globals.css';
import type { ReactNode } from 'react';

export const metadata = { title: 'Asistencia — Panel central', robots: { index: false, follow: false } };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
