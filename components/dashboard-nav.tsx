'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useTheme } from 'next-themes'
import { createClient } from '@/lib/supabase/client'
import { useUser } from '@/lib/hooks/use-user'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import {
  Brain,
  LayoutDashboard,
  ScrollText,
  BarChart3,
  Settings,
  LogOut,
  Menu,
  Sun,
  Moon,
  Laptop,
  Search,
  CircleDot,
  LayoutGrid,
  GitBranch,
  Key,
  MessageSquare,
  DollarSign,
} from 'lucide-react'

type NavItem = { href: string; label: string; icon: React.ComponentType<{ className?: string }> }
type NavSection = { title: string; items: NavItem[] }

const navSections: NavSection[] = [
  {
    title: 'Explore',
    items: [
      { href: '/dashboard/playground', label: 'Playground', icon: Search },
      { href: '/dashboard/entities', label: 'Entities', icon: CircleDot },
      { href: '/dashboard/coverage', label: 'Coverage', icon: LayoutGrid },
      { href: '/dashboard/graph', label: 'Graph', icon: GitBranch },
    ],
  },
  {
    title: 'Monitor',
    items: [
      { href: '/dashboard', label: 'Overview', icon: LayoutDashboard },
      { href: '/dashboard/logs', label: 'Query Logs', icon: ScrollText },
      { href: '/dashboard/analytics', label: 'Analytics', icon: BarChart3 },
    ],
  },
  {
    title: 'Manage',
    items: [
      { href: '/dashboard/keys', label: 'API Keys', icon: Key },
      { href: '/dashboard/feedback', label: 'Feedback', icon: MessageSquare },
      { href: '/dashboard/costs', label: 'Costs', icon: DollarSign },
      { href: '/dashboard/settings', label: 'Settings', icon: Settings },
    ],
  },
]

function NavLinks({ onClick }: { onClick?: () => void }) {
  const pathname = usePathname()

  return (
    <nav className="flex flex-col gap-4">
      {navSections.map((section) => (
        <div key={section.title} className="flex flex-col gap-1">
          <span className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground/60">
            {section.title}
          </span>
          {section.items.map((item) => {
            const Icon = item.icon
            const isActive =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href)

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClick}
                className={cn(
                  'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                  isActive
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )
}

function UserMenu() {
  const { user } = useUser()
  const { theme, setTheme } = useTheme()

  const handleSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.href = '/login'
  }

  const initials = user?.email
    ? user.email
        .split('@')[0]
        .split('.')
        .map((n) => n[0]?.toUpperCase())
        .join('')
    : '??'

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="w-full justify-start gap-3 px-3">
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-xs">{initials}</AvatarFallback>
          </Avatar>
          <span className="truncate text-sm">
            {user?.email ?? 'Loading...'}
          </span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem className="cursor-default p-3 hover:bg-transparent focus:bg-transparent">
          <div className="flex w-full flex-col gap-2">
            <ToggleGroup
              type="single"
              value={theme}
              onValueChange={(value) => value && setTheme(value)}
              className="w-full justify-between"
              size="sm"
            >
              <ToggleGroupItem value="light" aria-label="Light" className="cursor-pointer">
                <Sun className="h-4 w-4" />
                <span className="ml-1 text-xs">Light</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="dark" aria-label="Dark" className="cursor-pointer">
                <Moon className="h-4 w-4" />
                <span className="ml-1 text-xs">Dark</span>
              </ToggleGroupItem>
              <ToggleGroupItem value="system" aria-label="System" className="cursor-pointer">
                <Laptop className="h-4 w-4" />
                <span className="ml-1 text-xs">System</span>
              </ToggleGroupItem>
            </ToggleGroup>
          </div>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={handleSignOut}>
          <LogOut className="mr-2 h-4 w-4" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function DashboardNav() {
  return (
    <>
      {/* Desktop sidebar */}
      <aside className="hidden md:flex md:w-64 md:flex-col md:border-r md:bg-card">
        <div className="flex h-14 items-center gap-2 border-b px-4">
          <Brain className="h-5 w-5 text-primary" />
          <span className="font-semibold">DeloMemory</span>
        </div>
        <div className="flex flex-1 flex-col justify-between p-4">
          <NavLinks />
          <UserMenu />
        </div>
      </aside>

      {/* Mobile header */}
      <header className="flex h-14 items-center justify-between border-b px-4 md:hidden">
        <div className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          <span className="font-semibold">DeloMemory</span>
        </div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4">
            <div className="flex flex-col justify-between h-full pt-8">
              <NavLinks />
              <UserMenu />
            </div>
          </SheetContent>
        </Sheet>
      </header>
    </>
  )
}
