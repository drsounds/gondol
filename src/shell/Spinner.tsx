import { useEffect, useRef } from "react";
import lottie from "lottie-web";
import iconSpinnerAnimation from "../assets/lottie/icon-spinner.json";
import { SimpleSpinnerIcon } from "./SimpleSpinnerIcon";

export interface SpinnerProps {
  size?: number;
  label?: string;
  className?: string;
  /** Renders just the icon with the label kept for screen readers only, for use inline (e.g. inside a button). */
  inline?: boolean;
  /**
   * "brand" is the full lottie flower mark, for standalone/full-page loading states.
   * "simple" is a lightweight geometric mark for small inline uses like button loading states.
   */
  variant?: "brand" | "simple";
}

export function Spinner({ size = 120, label, className, inline = false, variant = "brand" }: SpinnerProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (variant !== "brand" || !containerRef.current) return;
    const animation = lottie.loadAnimation({
      container: containerRef.current,
      renderer: "svg",
      loop: true,
      autoplay: true,
      animationData: iconSpinnerAnimation,
    });
    return () => animation.destroy();
  }, [variant]);

  return (
    <span
      className={["spinner", inline ? "spinner--inline" : null, className].filter(Boolean).join(" ")}
      role="status"
      aria-live="polite"
    >
      {variant === "brand" ? (
        <div ref={containerRef} className="spinner__icon" style={{ width: size, height: size }} aria-hidden="true" />
      ) : (
        <div className="dot-elastic" style={{ width: size, height: size }} aria-hidden="true" />
      )}
      {label ? <span className={inline ? "sr-only" : "spinner__label"}>{label}</span> : null}
    </span>
  );
}
