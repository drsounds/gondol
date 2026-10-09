import { forwardRef, useId, type SelectHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ className, id, label, hint, children, ...props }, ref) {
  const generatedId = useId();
  const selectId = id ?? generatedId;
  return <div className="bungalow-field">{label ? <label className="bungalow-label" htmlFor={selectId}>{label}</label> : null}<select ref={ref} id={selectId} className={cn("bungalow-select", className)} {...props}>{children}</select>{hint ? <span className="bungalow-help">{hint}</span> : null}</div>;
});