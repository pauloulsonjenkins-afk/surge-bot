/**
 * A horse's head in profile, drawn to match the Lucide icons used everywhere else (24 x 24, round strokes, currentColor),
 * since Lucide has no horse (only a chess knight, whose base reads as a chess piece). Used for the Horses page.
 */
export function HorseHeadIcon({ size = 24, strokeWidth = 2, className }: { size?: number; strokeWidth?: number; className?: string }) {
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
      {/* Facing left: neck front, jaw, muzzle, forehead, ear, then the crest of the neck. */}
      <path d="M9 21c.4-2.6 1.3-4.6 2.6-6.1-1.6 1-3.3 1.7-5 1.8-1.6.1-2.7-.9-2.5-2.2.2-1.3 1.4-2.7 3.2-4.5l4.3-4.4.9-2.6 1.4 2.1c3.4 1 5.6 4.6 5.6 8.9 0 2.9-.6 5.1-1.3 7" />
      {/* The mane. */}
      <path d="M14.8 6.6c1.5 2 2.2 4.6 2 7.6" />
      {/* Eye and nostril. */}
      <circle cx="10.2" cy="9.3" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="5.7" cy="14.2" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}
