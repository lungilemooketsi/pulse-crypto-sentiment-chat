import { forwardRef, type CSSProperties, type SVGProps } from "react";

// The supplied logo, cropped into its stacked lockup and its two parts. The wordmark is white, so these sit on dark grounds only.
export function PulseLockup({ className, style }: { className?: string; style?: CSSProperties }) {
  return <img src="/pulse-logo.png" alt="Pulse" width={644} height={601} className={className} style={style} />;
}

export function PulseInline({ height = 28, className }: { height?: number; className?: string }) {
  return (
    <span className={className} style={{ display: "inline-flex", alignItems: "center", gap: height * 0.36 }}>
      <img src="/pulse-mark.png" alt="" width={403} height={442} style={{ height, width: "auto" }} />
      <img src="/pulse-wordmark.png" alt="Pulse" width={642} height={124} style={{ height: height * 0.42, width: "auto" }} />
    </span>
  );
}

// The four bars of the mark, traced on a 388 x 427 grid, for use as a shape.
const BARS = [
  { x0: 0, x1: 73, topLeft: 142, topRight: 104, bottom: 361 },
  { x0: 105, x1: 177, topLeft: 37, topRight: 0, bottom: 426 },
  { x0: 210, x1: 282, topLeft: 142, topRight: 104, bottom: 387 },
  { x0: 314, x1: 387, topLeft: 51, topRight: 13, bottom: 309 },
];

function barPath({ x0, x1, topLeft, topRight, bottom }: (typeof BARS)[number]) {
  return `M${x0} ${topLeft} L${x1} ${topRight} V${bottom} H${x0} Z`;
}

export const PulseMark = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function PulseMark(props, ref) {
  return (
    <svg ref={ref} viewBox="0 0 388 427" fill="currentColor" aria-hidden="true" {...props}>
      {BARS.map((bar) => (
        <path key={bar.x0} d={barPath(bar)} />
      ))}
    </svg>
  );
});
