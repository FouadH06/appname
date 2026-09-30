import type { SVGProps } from 'react';

// Outline glyphs for the catalog's category icon keys (categories.icon). Unknown keys fall back to a
// neutral mark, so ops can add categories without a code change.

const paths: Record<string, string> = {
  scissors: 'M6 7.5a2.5 2.5 0 1 0 0-.01M6 16.5a2.5 2.5 0 1 0 0-.01M8.2 8.6 20 18M8.2 15.4 20 6',
  razor: 'M4 16.5 14.5 6l3.5 3.5L7.5 20zM14.5 6l2-2 3.5 3.5-2 2M9 14l2 2',
  hand: 'M8 13V6.5a1.5 1.5 0 0 1 3 0V12M11 11V5a1.5 1.5 0 0 1 3 0v6M14 11V6.5a1.5 1.5 0 0 1 3 0V14a6 6 0 0 1-6 6h-.5a5 5 0 0 1-4-2l-2.8-3.8a1.5 1.5 0 0 1 2.3-1.9L8 13.5',
  eye: 'M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12zM12 9.2a2.8 2.8 0 1 0 0 5.6 2.8 2.8 0 0 0 0-5.6z',
  brush: 'M14 4.5 19.5 10 11 18.5H5.5V13zM12 6.5l5.5 5.5M5.5 18.5 3.5 20.5',
  leaf: 'M5 19C5 9.5 11 5 20 4.5 19.5 13.5 15 19 5.5 19M5 19l7.5-7.5',
  flower:
    'M12 9.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM12 9.5V5.5a2.5 2.5 0 0 1 0 0M9.6 11.2 6 9.5M14.4 11.2 18 9.5M10.4 14.3 8.5 18M13.6 14.3 15.5 18M12 5a2.5 2.5 0 1 1 0 .01',
  sparkles:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z',
};

export function CategoryIcon({
  icon,
  ...p
}: Omit<SVGProps<SVGSVGElement>, 'name'> & { icon: string | null }) {
  return (
    <svg
      width={26}
      height={26}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...p}
    >
      <path d={paths[icon ?? ''] ?? paths.sparkles} />
    </svg>
  );
}
