import { createContext, useContext, type ReactNode } from "react";

/**
 * Renders the "new feature" dot an app shows on a `data-tour` target (or nothing). AppShell provides
 * it from its `featureDot` prop, so every NavItem gets one.
 */
export type FeatureDot = (target: string, options?: { prefix?: string }) => ReactNode;

export const FeatureDotContext = createContext<FeatureDot>(() => null);

/**
 * One item of the shell's navigation (the sidebar, the phone tab bar and the menu drawer).
 * `extra`: desktop-sidebar only. `afterAdd`: sits right of the plus button in the mobile tab bar.
 * `mobileOnly`: mobile tab bar only.
 */
export function NavItem({
  icon,
  label,
  active,
  onClick,
  extra,
  afterAdd,
  mobileOnly,
  tourId,
  dot,
}: {
  icon: ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  extra?: boolean;
  afterAdd?: boolean;
  mobileOnly?: boolean;
  /** data-tour key (guides, update dots); defaults to `nav-<tab>`. */
  tourId?: string;
  /** Blue "update available" dot on the icon (the mobile tab leading to Account). */
  dot?: boolean;
}) {
  const featureDot = useContext(FeatureDotContext);
  const className = ["nav-item", extra ? "nav-item--extra" : "", afterAdd ? "nav-item--after-add" : "", mobileOnly ? "nav-item--mobile-only" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={className}
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      data-tour={tourId}
      title={label}
    >
      <span className="nav-item__icon-wrap">
        <span className="nav-item__icon">{icon}</span>
        {dot ? <span className="update-dot" aria-hidden="true" /> : tourId ? featureDot(tourId) : null}
      </span>
      <span className="nav-item__label">{label}</span>
    </button>
  );
}
