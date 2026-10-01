import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Open Overskill — Build your own AI app builder",
  description:
    "A customizable builder interface powered by the Overskill partner API. Explore the local pilot.",
  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><rect width='100' height='100' rx='24' fill='%2345e760'/><path d='M35 30 15 50l20 20m30-40 20 20-20 20' fill='none' stroke='%23202123' stroke-width='8'/></svg>",
  },
};

export const viewport: Viewport = {
  themeColor: "#202123",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" data-scroll-behavior="smooth" suppressHydrationWarning>
      <head>
        {/* Apply the saved theme before paint to avoid a flash. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('open-overskill-theme');if(t!=='light'){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
