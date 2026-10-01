/**
 * A horseshoe, drawn to match the Lucide icons used everywhere else (24 x 24, round strokes, currentColor), since
 * Lucide has no horse or horseshoe. Open end down with nail holes, so it reads as a horseshoe rather than a magnet.
 * Used for the Horses page.
 */
export function HorseshoeIcon({ size = 24, strokeWidth = 2, className }: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {/* The shoe: an arch with its heels at the bottom. */}
      <path d="M4.5 20.5C3.4 15.5 3.6 10.6 5.7 7.4 7.3 4.9 9.6 3.5 12 3.5s4.7 1.4 6.3 3.9c2.1 3.2 2.3 8.1 1.2 13.1h-3.3c.8-4 .6-7.4-.8-9.6-.9-1.4-2-2.1-3.4-2.1s-2.5.7-3.4 2.1c-1.4 2.2-1.6 5.6-.8 9.6Z" />
      {/* Nail holes. */}
      <circle cx="6.2" cy="15.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="7.4" cy="9.8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="17.8" cy="15.5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="16.6" cy="9.8" r="0.7" fill="currentColor" stroke="none" />
    </svg>
  );
}
