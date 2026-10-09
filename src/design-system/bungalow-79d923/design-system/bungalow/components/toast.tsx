import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface ToastProps extends HTMLAttributes<HTMLDivElement> {
  tone?: "success" | "warning" | "danger" | "info";
  title: string;
  message?: string;
}

export const Toast = forwardRef<HTMLDivElement, ToastProps>(function Toast({ className, title, message, tone = "info", ...props }, ref) {
  return <div ref={ref} role="status" className={cn("bungalow-toast", `bungalow-toast--${tone}`, className)} {...props}><span className="bungalow-toast__dot" aria-hidden="true" /><span className="bungalow-toast__content"><span className="bungalow-toast__title">{title}</span>{message ? <span className="bungalow-toast__message">{message}</span> : null}</span></div>;
});