import { forwardRef, type DetailsHTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/utils";

export interface AccordionProps extends Omit<DetailsHTMLAttributes<HTMLDetailsElement>, "title"> {
  title: ReactNode;
}

export const Accordion = forwardRef<HTMLDetailsElement, AccordionProps>(function Accordion({ className, title, children, ...props }, ref) {
  return <details ref={ref} className={cn("bungalow-accordion", className)} {...props}><summary>{title}</summary><div className="bungalow-accordion__content">{children}</div></details>;
});