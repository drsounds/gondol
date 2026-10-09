import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "../lib/utils";

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  label: string;
}

export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(function Checkbox({ className, label, disabled, ...props }, ref) {
  return <label className={cn("bungalow-check", disabled && "bungalow-check--disabled", className)}><input ref={ref} type="checkbox" disabled={disabled} {...props} /><span>{label}</span></label>;
});