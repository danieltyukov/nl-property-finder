import type { IconName } from '../components/Icon';

export interface NavItem {
  path: string;
  label: string;
  icon: IconName;
}

export const NAV: { group: string; items: NavItem[] }[] = [
  {
    group: 'Work',
    items: [
      { path: '/', label: 'Inbox', icon: 'inbox' },
      { path: '/overview', label: 'Overview', icon: 'overview' },
      { path: '/properties', label: 'Properties', icon: 'home' },
      { path: '/applications', label: 'Applications', icon: 'board' },
      { path: '/conversations', label: 'Conversations', icon: 'message' },
      { path: '/viewings', label: 'Viewings', icon: 'calendar' },
    ],
  },
  {
    group: 'Setup',
    items: [
      { path: '/search', label: 'Search', icon: 'map' },
      { path: '/sources', label: 'Sources', icon: 'sources' },
      { path: '/profile', label: 'Profile', icon: 'user' },
      { path: '/automation', label: 'Automation', icon: 'sliders' },
      { path: '/settings', label: 'Settings', icon: 'gear' },
    ],
  },
  { group: 'Log', items: [{ path: '/activity', label: 'Activity', icon: 'activity' }] },
];

export const ALL_NAV: NavItem[] = NAV.flatMap((g) => g.items);

export function navFor(location: string): NavItem {
  if (location === '/' || location === '') return ALL_NAV[0]!;
  return ALL_NAV.find((item) => item.path !== '/' && (location === item.path || location.startsWith(`${item.path}/`))) ?? ALL_NAV[0]!;
}
