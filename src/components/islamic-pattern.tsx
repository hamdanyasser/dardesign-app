import { cn } from "@/lib/utils";

const STAR_SVG = encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100">
    <rect x="22" y="22" width="56" height="56" fill="none" stroke="#8B7432" stroke-width="0.8" transform="rotate(0 50 50)"/>
    <rect x="22" y="22" width="56" height="56" fill="none" stroke="#8B7432" stroke-width="0.8" transform="rotate(45 50 50)"/>
  </svg>`
);

export default function IslamicPattern({
  className,
  opacity = 0.04,
}: {
  className?: string;
  opacity?: number;
}) {
  return (
    <div
      className={cn("absolute inset-0 pointer-events-none", className)}
      style={{
        backgroundImage: `url("data:image/svg+xml,${STAR_SVG}")`,
        backgroundSize: "120px 120px",
        backgroundRepeat: "repeat",
        opacity,
      }}
    />
  );
}
