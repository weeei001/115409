import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/** focus-lamp 與 focus-lamp-inset（styles/main.css）是同一組：後寫的取代前面的 */
const twMerge = extendTailwindMerge<'focus-lamp'>({ extend: { classGroups: { 'focus-lamp': ['focus-lamp', 'focus-lamp-inset'] } } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
