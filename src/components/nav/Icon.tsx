const PATHS: Record<string, React.ReactNode> = {
  home: (
    <>
      <path d="M4 11.5 12 4l8 7.5" />
      <path d="M6 10v9a1 1 0 0 0 1 1h4v-6h2v6h4a1 1 0 0 0 1-1v-9" />
    </>
  ),
  check: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8.5 12 2.5 2.5 4.5-5" />
    </>
  ),
  calendar: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M8 3v4M16 3v4M3.5 10h17" />
    </>
  ),
  people: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 8a3 3 0 1 1 3.2 3M14.7 12.3A5.5 5.5 0 0 1 20.5 17" />
    </>
  ),
  grid: (
    <>
      <rect x="4" y="4" width="7" height="7" rx="1.2" />
      <rect x="13" y="4" width="7" height="7" rx="1.2" />
      <rect x="4" y="13" width="7" height="7" rx="1.2" />
      <rect x="13" y="13" width="7" height="7" rx="1.2" />
    </>
  ),
  budget: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5v9M14.7 9.8c-.4-.9-1.4-1.4-2.7-1.4-1.6 0-2.8.8-2.8 2s1.2 1.7 2.8 2c1.6.3 2.8.8 2.8 2s-1.2 2-2.8 2c-1.3 0-2.3-.5-2.7-1.4" />
    </>
  ),
  map: (
    <>
      <path d="M12 21s-6.5-5.8-6.5-10.5a6.5 6.5 0 1 1 13 0C18.5 15.2 12 21 12 21Z" />
      <circle cx="12" cy="10.5" r="2.2" />
    </>
  ),
  recruitment: (
    <>
      <circle cx="9" cy="8.5" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M18 8v5M15.5 10.5h5" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.5 3 7.7 7 9 4-1.3 7-4.5 7-9V6l-7-2.5Z" />
      <path d="m9 12 2 2 4-4.5" />
    </>
  ),
  gear: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M17.8 6.2l-1.4 1.4M7.6 16.4l-1.4 1.4M17.8 17.8l-1.4-1.4M7.6 7.6 6.2 6.2" />
    </>
  ),
  chevronLeft: <path d="m14.5 5-7 7 7 7" />,
  chevronRight: <path d="m9.5 5 7 7-7 7" />,
  menu: <path d="M4 6.5h16M4 12h16M4 17.5h16" />,
  close: <path d="M5 5l14 14M19 5 5 19" />,
  pin: (
    <path d="m12 3 2.2 4.9L19.5 9l-4 3.8.9 5.4L12 15.6l-4.4 2.6.9-5.4-4-3.8 5.3-1.1L12 3Z" />
  ),
  logout: (
    <>
      <path d="M9 20H5.5a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 5.5 4H9" />
      <path d="M15 16l4.5-4-4.5-4M19 12H9" />
    </>
  ),
};

export function Icon({ name, className }: { name: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "h-5 w-5"}
      aria-hidden="true"
    >
      {PATHS[name] ?? PATHS.grid}
    </svg>
  );
}
