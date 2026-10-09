import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "default" | "success" | "warning" | "danger" | "info" | "contrast" | "primary";
}

export const Alert = forwardRef<HTMLDivElement, AlertProps>(function Alert({ className, children, tone = "default", ...props }, ref) {
  return <div ref={ref} role={tone === "danger" ? "alert" : "status"} className={cn("bungalow-alert", `bungalow-alert--${tone}`, className)} {...props}><span className="bungalow-alert__mark" aria-hidden="true">{tone === "success" ? "✓" : tone === "warning" || tone === "danger" ? "!" : "i"}</span>{children}</div>;
});