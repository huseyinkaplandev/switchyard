import type { Metadata } from 'next';
import './globals.css';
import AssistantUIRoot from './_components/assistant-ui/AssistantUIRoot';

export const metadata: Metadata = {
  title: 'Switchyard',
  description: 'One local yard for every AI coding session: search the archive, watch agents live, track schedules, and hand a chat to another account or tool when the limit hits.',
  icons: [
    { rel: 'icon', url: '/favicon.svg', type: 'image/svg+xml', sizes: 'any' },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body data-assistant-ui className="antialiased min-h-screen">
        <AssistantUIRoot>{children}</AssistantUIRoot>
      </body>
    </html>
  );
}
