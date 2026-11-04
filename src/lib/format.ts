// Shared display helpers.

/** A percentage with its sign, using a true minus: "+1.2%", "−3.4%", "0.0%". */
export const signedPercent = (percent: number) => `${percent > 0 ? "+" : percent < 0 ? "−" : ""}${Math.abs(percent).toFixed(1)}%`;

// Chart colours, read from the page's tokens so charts follow the theme.
export const chartColours = {
  line: "hsl(var(--brand))",
  surface: "hsl(var(--card))",
  grid: "#2a2a2a",
  muted: "hsl(var(--muted-foreground))",
};
