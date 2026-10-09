import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export type CardProps = HTMLAttributes<HTMLDivElement>;

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card({ className, ...props }, ref) {
  return <div ref={ref} className={cn("bungalow-card", className)} {...props} />;
});