import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merges conditional class names and resolves Tailwind conflicts.
 * @param inputs Class values to combine.
 * @returns Merged class name string.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * Extracts the bare hostname from a site origin or domain for display.
 * @param originOrDomain Site origin (e.g. "https://acme.dev") or hostname.
 * @returns Hostname without scheme, or the input unchanged if it can't be parsed.
 */
export function hostnameOf(originOrDomain: string): string {
  try {
    return new URL(originOrDomain).hostname;
  } catch {
    return originOrDomain.replace(/^https?:\/\//, "").replace(/\/.*$/, "");
  }
}
