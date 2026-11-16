import type { SVGProps } from "react";

/** Glyphs the bungalow icon font doesn't have (shuffle, volume, queue, chevrons). */
const base = (props: SVGProps<SVGSVGElement>) => ({ width: 18, height: 18, viewBox: "0 0 20 20", "aria-hidden": true, fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, ...props });

export const ShuffleIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M3 6h3c4 0 4 8 8 8h3M14.5 11.5 17 14l-2.5 2.5M3 14h3c1.4 0 2.2-1 3-2.3M11 8.3C11.8 7 12.6 6 14 6h3M14.5 3.5 17 6l-2.5 2.5" />
  </svg>
);

export const RepeatIcon = ({ one, ...props }: SVGProps<SVGSVGElement> & { one?: boolean }) => (
  <svg {...base(props)}>
    <path d="M4 9V8a3 3 0 0 1 3-3h9M13.5 2.5 16 5l-2.5 2.5M16 11v1a3 3 0 0 1-3 3H4M6.5 17.5 4 15l2.5-2.5" />
    {one ? <text x="10" y="12.6" fontSize="6.5" textAnchor="middle" fill="currentColor" stroke="none" fontWeight="700">1</text> : null}
  </svg>
);

export const VolumeIcon = ({ level, ...props }: SVGProps<SVGSVGElement> & { level: number }) => (
  <svg {...base(props)}>
    <path d="M3 8v4h3l4 3.5v-11L6 8H3z" fill="currentColor" stroke="none" />
    {level <= 0 ? <path d="M13 8l4 4M17 8l-4 4" /> : null}
    {level > 0 ? <path d="M13 8.2a2.5 2.5 0 0 1 0 3.6" /> : null}
    {level > 0.5 ? <path d="M15 6.2a5.3 5.3 0 0 1 0 7.6" /> : null}
  </svg>
);

export const QueueIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M3 5h14M3 10h9M3 15h9M15 12.5v5l3.5-2.5z" />
  </svg>
);

export const ExpandIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M12 3h5v5M8 17H3v-5M17 3l-6 6M3 17l6-6" />
  </svg>
);

export const ChevronDownIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M4 7l6 6 6-6" />
  </svg>
);

export const MusicNoteIcon = (props: SVGProps<SVGSVGElement>) => (
  <svg {...base(props)}>
    <path d="M8 15V4l9-2v11" />
    <circle cx="5.5" cy="15" r="2.5" />
    <circle cx="14.5" cy="13" r="2.5" />
  </svg>
);
