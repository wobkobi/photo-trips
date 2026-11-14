// The To the Point Tech chip mark. logo.svg is the website's public/source/logo.svg, copied
// unchanged, so a new logo only needs the file replaced.
import logoUrl from "../assets/logo.svg";

/**
 * The To the Point Tech chip, in the current text colour. The logo is used as a mask over a
 * block filled with `currentColor`, so only its shape counts and its own violet fill is ignored.
 * @param props.size - width and height in pixels
 * @param props.className - extra classes; the colour comes from `color`
 * @returns the mark, hidden from screen readers since the name is written beside it
 */
export function BrandMark({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`block bg-current ${className}`}
      style={{ width: size, height: size, mask: `url("${logoUrl}") center / contain no-repeat` }}
    />
  );
}
