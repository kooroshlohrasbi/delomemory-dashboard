import { DashboardNav } from '@/components/dashboard-nav'

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-col md:flex-row min-h-screen">
      {/* WCAG 2.4.1: Skip navigation for keyboard users */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-4 focus:left-4 focus:p-4 focus:bg-background focus:border focus:rounded-md"
      >
        Skip to main content
      </a>
      <DashboardNav />
      <main id="main-content" className="flex-1 overflow-auto">
        <div className="container mx-auto p-6">{children}</div>
      </main>
    </div>
  )
}
