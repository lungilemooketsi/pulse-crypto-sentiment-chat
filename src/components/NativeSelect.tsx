import type { SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** A browser select in the app's field style. */
const NativeSelect = ({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) => (
  <select className={cn("h-10 bg-background border border-input px-3 text-sm text-foreground", className)} {...props} />
);

export default NativeSelect;
