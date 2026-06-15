/**
 * Linear-weight icon set (1.5px stroke, currentColor) used across the dark UI.
 * Ported from the design prototype so every screen shares one visual language.
 */
import type { ReactElement, ReactNode, SVGProps } from "react";

interface IconProperties extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  size?: number;
}

function Icon({
  children,
  size = 16,
  fill,
  ...rest
}: IconProperties & { children: ReactNode }): ReactElement {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill ?? "none"}
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const Icons = {
  arrow: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </Icon>
  ),
  copy: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <rect x="9" y="9" width="11" height="11" rx="1.5" />
      <path d="M5 15V5a1.5 1.5 0 0 1 1.5-1.5H15" />
    </Icon>
  ),
  check: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="m4 12 5 5L20 6" />
    </Icon>
  ),
  download: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M12 4v11" />
      <path d="m7 11 5 5 5-5" />
      <path d="M5 20h14" />
    </Icon>
  ),
  external: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M14 5h5v5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14v4.5A1.5 1.5 0 0 1 16.5 20h-9A1.5 1.5 0 0 1 6 18.5v-9A1.5 1.5 0 0 1 7.5 8H12" />
    </Icon>
  ),
  file: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M7 3.5h7L19 8v11.5A1 1 0 0 1 18 20.5H7A1 1 0 0 1 6 19.5v-15A1 1 0 0 1 7 3.5Z" />
      <path d="M14 3.5V8h5" />
    </Icon>
  ),
  clock: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  ),
  globe: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17" />
      <path d="M12 3.5c2.5 2.3 2.5 14.7 0 17M12 3.5c-2.5 2.3-2.5 14.7 0 17" />
    </Icon>
  ),
  search: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </Icon>
  ),
  layers: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3Z" />
      <path d="m4 12 8 4.5 8-4.5" />
    </Icon>
  ),
  spark: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M12 8.5a3.5 3.5 0 0 0 0 7 3.5 3.5 0 0 0 0-7Z" />
    </Icon>
  ),
  history: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 4v3.5H7" />
      <path d="M12 8v4.2l3 1.8" />
    </Icon>
  ),
  link: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M9.5 14.5 14.5 9.5" />
      <path d="M11 7.5 12.6 6A3.6 3.6 0 0 1 18 11l-1.6 1.6" />
      <path d="M13 16.5 11.4 18A3.6 3.6 0 0 1 6 13l1.6-1.6" />
    </Icon>
  ),
  bolt: (p: IconProperties): ReactElement => (
    <Icon {...p}>
      <path d="M13 3 5 13h6l-1 8 8-10h-6l1-8Z" />
    </Icon>
  ),
};
