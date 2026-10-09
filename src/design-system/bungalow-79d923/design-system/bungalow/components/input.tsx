import { forwardRef, useId, type InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ className, id, label, hint, error, ...props }, ref) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const helpId = `${inputId}-help`;
  return <div className="bungalow-field">{label ? <label className="bungalow-label" htmlFor={inputId}>{label}</label> : null}<input ref={ref} id={inputId} className={cn("bungalow-input", className)} aria-invalid={Boolean(error)} aria-describedby={hint || error ? helpId : undefined} {...props} />{error || hint ? <span id={helpId} className={cn("bungalow-help", Boolean(error) && "bungalow-help--error")}>{error ?? hint}</span> : null}</div>;
});