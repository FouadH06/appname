import type { Role } from './context';

export interface NavItem {
  key: string;
  label: string;
  /** Path under /biz/[businessId] */
  path: string;
  icon: string;
  roles: Role[];
  /** Shown in the mobile bottom bar (others go under "More") */
  bottom?: boolean;
}

// Phase 2 Part 1 §8.4. Items outside a role are hidden, not disabled.
const ALL: Role[] = ['owner', 'manager', 'reception', 'staff'];
const DESK: Role[] = ['owner', 'manager', 'reception'];
const MANAGE: Role[] = ['owner', 'manager'];

export const NAV: NavItem[] = [
  { key: 'overview', label: 'Overview', path: '', icon: '⌂', roles: ALL, bottom: true },
  { key: 'calendar', label: 'Calendar', path: '/calendar', icon: '▦', roles: ALL, bottom: true },
  { key: 'bookings', label: 'Bookings', path: '/bookings', icon: '☰', roles: DESK },
  { key: 'customers', label: 'Customers', path: '/customers', icon: '☺', roles: ALL, bottom: true },
  { key: 'services', label: 'Services', path: '/services', icon: '✂', roles: MANAGE },
  { key: 'staff', label: 'Staff', path: '/staff', icon: '◍', roles: DESK },
  { key: 'reviews', label: 'Reviews', path: '/reviews', icon: '★', roles: MANAGE },
  { key: 'analytics', label: 'Analytics', path: '/analytics', icon: '◔', roles: MANAGE },
  { key: 'settings', label: 'Settings', path: '/settings', icon: '⚙', roles: MANAGE },
];

export function navFor(role: Role, isDraft: boolean): NavItem[] {
  const items = NAV.filter((i) => i.roles.includes(role));
  if (isDraft && MANAGE.includes(role)) {
    items.splice(1, 0, { key: 'setup', label: 'Set up', path: '/setup', icon: '✓', roles: MANAGE });
  }
  return items.map((i) =>
    i.key === 'overview' && role === 'staff' ? { ...i, label: 'Today' } : i,
  );
}

/** Fired by the global ＋ when the calendar is already open (opens the drawer in place). */
export const NEW_APPOINTMENT_EVENT = 'biz:new-appointment';
