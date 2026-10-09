import { forwardRef, type ButtonHTMLAttributes } from "react";
import { Spinner } from "../../../../../shell/Spinner";
import { cn } from "../lib/utils";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "solid" | "outline" | "ghost";
  tone?: "default" | "success" | "warning" | "danger" | "info" | "contrast" | "primary";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, children, variant = "solid", tone = "contrast", size = "md", loading = false, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn("bungalow-button", `bungalow-button--${variant}`, `bungalow-button--${size}`, `bungalow-tone-${tone}`, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading && <Spinner inline variant="simple" size={16} label="Working…" />}&nbsp;{children}
    </button>
  );
});