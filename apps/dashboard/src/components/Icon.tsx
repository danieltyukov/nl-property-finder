/*
 * 16px line icons on a 16-unit grid, 1.5px stroke, drawn for this dashboard so
 * there is no icon font or third-party set. They are always decoration next to
 * a visible word, or inside a button that has its own accessible name.
 */
const PATHS = {
  inbox: 'M2 9.5h3.5l1 2h3l1-2H14M2 9.5V13h12V9.5M2 9.5 4 3h8l2 6.5',
  overview: 'M2.5 13.5h11M4 11V8M7 11V4.5M10 11V6.5M13 11V9',
  home: 'M2.5 7.5 8 3l5.5 4.5M4 6.5v7h8v-7M6.75 13.5v-3.5h2.5v3.5',
  board: 'M2.5 3h3v10h-3zM6.5 3h3v6.5h-3zM10.5 3h3v8h-3z',
  message: 'M2.5 3.5h11v7.5H7l-3 2.5V11H2.5z',
  calendar: 'M2.5 4h11v9.5h-11zM2.5 7h11M5.5 2.5v3M10.5 2.5v3',
  sources: 'M8 8.75a.75.75 0 1 0 0-1.5.75.75 0 0 0 0 1.5ZM5.2 10.8a4 4 0 0 1 0-5.6M10.8 5.2a4 4 0 0 1 0 5.6M3.1 12.9a7 7 0 0 1 0-9.8M12.9 3.1a7 7 0 0 1 0 9.8',
  map: 'M2.5 4 6 2.5l4 1.5 3.5-1.5V12L10 13.5 6 12l-3.5 1.5zM6 2.5V12M10 4v9.5',
  user: 'M8 7.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5ZM3 13.5c.6-2.4 2.6-4 5-4s4.4 1.6 5 4',
  sliders: 'M3 4.5h6M12 4.5h1M3 11.5h1M7 11.5h6M9 3v3M5.5 10v3',
  gear: 'M8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.6 3.6l1.05 1.05M11.35 11.35l1.05 1.05M3.6 12.4l1.05-1.05M11.35 4.65l1.05-1.05',
  activity: 'M2 8.5h2.5L6 4l3.5 8L11 8.5h3',
  search: 'M7 11.5a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9ZM10.3 10.3 13.5 13.5',
  pause: 'M5.5 3.5v9M10.5 3.5v9',
  play: 'M5 3.2v9.6L12.5 8z',
  menu: 'M2.5 4.5h11M2.5 8h11M2.5 11.5h11',
  close: 'M4 4l8 8M12 4l-8 8',
  up: 'M4 10l4-4 4 4',
  down: 'M4 6l4 4 4-4',
  left: 'M10 4 6 8l4 4',
  right: 'M6 4l4 4-4 4',
  external: 'M9 3h4v4M13 3 7.5 8.5M11.5 9.5V13H3V4.5h3.5',
  copy: 'M5.5 5.5h7v8h-7zM3.5 10.5v-8h7',
  check: 'M3 8.5 6.5 12 13 4.5',
  plus: 'M8 3v10M3 8h10',
  trash: 'M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9',
  upload: 'M8 10.5V3M5 6l3-3 3 3M3 10.5V13h10v-2.5',
  refresh: 'M12.5 7A4.5 4.5 0 0 0 4.2 5.2M3.5 9a4.5 4.5 0 0 0 8.3 1.8M4 2.5v3h3M12 13.5v-3H9',
  key: 'M6 10a3 3 0 1 1 2.8-4h4.7v2h-1.5v1.5h-2V8H8.8A3 3 0 0 1 6 10Z',
  phone: 'M4 2.5h2.5l1 3-1.5 1a7 7 0 0 0 3.5 3.5l1-1.5 3 1V12A1.5 1.5 0 0 1 12 13.5 9.5 9.5 0 0 1 2.5 4 1.5 1.5 0 0 1 4 2.5Z',
  file: 'M4 2h5l3 3v9H4zM9 2v3h3',
  clock: 'M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12ZM8 4.5V8l2.5 1.5',
  table: 'M2.5 3.5h11v9h-11zM2.5 6.5h11M2.5 9.5h11M6 6.5v6',
  eye: 'M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8ZM8 10a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z',
  link: 'M6.5 9.5l3-3M7 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M9 11.5l-1 1a2.5 2.5 0 0 1-3.5-3.5l1-1',
  flag: 'M3.5 14V2.5M3.5 3h8l-2 3 2 3h-8',
  bolt: 'M9 1.5 3.5 9H8l-1 5.5L12.5 7H8z',
  command: 'M11 2.5 5 13.5',
  sparkle: 'M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M10 10l2 2M12 4l-2 2M6 10l-2 2',
  moon: 'M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z',
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  if (name === 'moon') {
    // The owner's theme glyph: a circle, half filled.
    return (
      <svg className={className} viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false">
        <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="1.4" />
        <path d="M8 2 A6 6 0 0 0 8 14 Z" fill="currentColor" />
      </svg>
    );
  }
  const filled = name === 'play';
  return (
    <svg
      className={className}
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}
