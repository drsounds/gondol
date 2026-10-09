import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: "default" | "success" | "warning" | "danger" | "info" | "contrast" | "primary";
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(function Badge({ className, tone = "default", ...props }, ref) {
  return <span ref={ref} className={cn("bungalow-badge", `bungalow-badge--${tone}`, className)} {...props} />;
});