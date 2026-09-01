import { LayoutDashboard, Users, UserPlus, Briefcase, type LucideIcon } from 'lucide-react'

/**
 * The two workspaces behind the single staff login.
 *
 * Defined once so the chooser (`/`) and the sidebar switcher can't drift apart
 * on names, routes or which paths belong where.
 */

export type WorkspaceId = 'leads' | 'sbr'

export interface WorkspaceNavItem {
  href: string
  label: string
  icon: LucideIcon
}

export interface Workspace {
  id: WorkspaceId
  /** Shown in the workspace switcher and on the chooser card. */
  name: string
  /** Expanded name, for the chooser card where there is room for it. */
  fullName: string
  description: string
  /** Where the workspace opens. */
  href: string
  icon: LucideIcon
  nav: WorkspaceNavItem[]
  /** Route prefixes owned by this workspace. */
  prefixes: string[]
  /**
   * How the workspace frames itself. A single-page workspace doesn't earn a
   * sidebar, so it gets a slim top bar carrying the same controls instead.
   */
  chrome: 'sidebar' | 'topbar'
  /** Live count shown in the workspace chrome. Resolved by WorkspaceTopBar. */
  badge?: 'leadFollowUps'
}

// Leads first — it comes first in the workflow.
export const WORKSPACES: Workspace[] = [
  {
    id: 'leads',
    name: 'CRM',
    fullName: 'Customer Relationship Management',
    description: 'New enquiries from Facebook and the website',
    href: '/leads',
    icon: UserPlus,
    nav: [{ href: '/leads', label: 'Leads', icon: Users }],
    prefixes: ['/leads'],
    // One page — a sidebar listing a single link is just chrome.
    chrome: 'topbar',
    badge: 'leadFollowUps',
  },
  {
    id: 'sbr',
    name: 'SBR',
    fullName: 'Small Business Restructuring',
    description: 'Client files, documents and restructuring analysis',
    href: '/sbr',
    icon: Briefcase,
    nav: [
      { href: '/sbr', label: 'Dashboard', icon: LayoutDashboard },
      { href: '/clients', label: 'Clients', icon: Users },
    ],
    prefixes: ['/sbr', '/clients'],
    chrome: 'sidebar',
  },
]

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`)
}

/**
 * The workspace a path belongs to, or null when it belongs to neither —
 * the chooser at `/` being the case that matters.
 */
export function workspaceForPath(pathname: string): Workspace | null {
  return WORKSPACES.find((w) => w.prefixes.some((p) => matchesPrefix(pathname, p))) ?? null
}
