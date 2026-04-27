import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge Tailwind class names. Resolves conflicting utilities (e.g.
 * `cn("px-2", "px-4")` → `"px-4"`). Use everywhere instead of template
 * strings.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
