import Link from "next/link";
import type { ReactElement } from "react";

export function Logo(): ReactElement {
  return (
    <Link href="/" className="logo" aria-label="llms.txt home">
      <span className="logo-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path
            d="M12 11.1 C8.8 11.1 9 14.6 9.4 16.9 C9.7 18.9 10.6 20.7 12 21.3 C13.4 20.7 14.3 18.9 14.6 16.9 C15 14.6 15.2 11.1 12 11.1 Z"
            fill="currentColor"
          />
          <circle cx="12" cy="9.5" r="1.5" fill="currentColor" />
          <circle cx="12" cy="5.7" r="2.3" fill="currentColor" />
          <path
            d="M10.9 4 L9.4 2.2 M13.1 4 L14.6 2.2"
            stroke="currentColor"
            strokeWidth="1.35"
            strokeLinecap="round"
          />
          <path
            d="M10.8 8.8 L8 7.4 L6.2 8.6 M13.2 8.8 L16 7.4 L17.8 8.6 M10.6 9.9 L6.6 10.1 L5 11.7 M13.4 9.9 L17.4 10.1 L19 11.7 M10.8 11 L8 12.9 L6.2 14.3 M13.2 11 L16 12.9 L17.8 14.3"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="10.9" cy="5.5" r="0.66" className="logo-eye" />
          <circle cx="13.1" cy="5.5" r="0.66" className="logo-eye" />
        </svg>
      </span>
      <span className="logo-word">
        llms<span className="logo-dim">.txt</span>
      </span>
    </Link>
  );
}
