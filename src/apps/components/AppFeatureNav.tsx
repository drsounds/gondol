import { Button, Icon, type IconName } from "../../design-system/bungalow-79d923";
import type { AppFeature, InternalAppBundle } from "../types";
import { InternalAppBadge } from "./InternalAppBadge";

export function AppFeatureNav({
  app,
  activeFeatureId,
  isActive,
  onSelectFeature,
  onToggleActive,
  onBackToApps,
}: {
  app: InternalAppBundle;
  activeFeatureId: string;
  isActive: boolean;
  onSelectFeature: (featureId: string) => void;
  onToggleActive: () => void;
  onBackToApps: () => void;
}) {
  return (
    <div
      className="app-bundle-header"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.75rem",
        padding: "1rem 1.25rem 0",
        borderBottom: "1px solid var(--bungalow-border-subtle, rgba(255, 255, 255, 0.08))",
        background: "var(--bungalow-bg-surface, var(--chrome-bg))",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: "0.75rem",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "36px",
              height: "36px",
              borderRadius: "8px",
              background: "rgba(99, 102, 241, 0.15)",
              color: "var(--bungalow-color-primary, #6366f1)",
            }}
          >
            <Icon name={app.iconName as IconName} />
          </div>
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
              <h1 style={{ margin: 0, fontSize: "1.25rem", fontWeight: 700 }}>{app.name}</h1>
              <InternalAppBadge active={isActive} />
            </div>
            <p className="stat-label" style={{ margin: "0.15rem 0 0", fontSize: "0.85rem" }}>
              {app.description}
            </p>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          <Button
            size="sm"
            variant="outline"
            tone={isActive ? "contrast" : "primary"}
            onClick={onToggleActive}
            title={isActive ? "Deactivate app" : "Activate app"}
          >
            {isActive ? "Deactivate" : "Activate"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onBackToApps}>
            All Apps
          </Button>
        </div>
      </div>

      {isActive && app.features.length > 1 ? (
        <div
          role="tablist"
          style={{
            display: "flex",
            gap: "0.5rem",
            overflowX: "auto",
            paddingBottom: "0.5rem",
          }}
        >
          {app.features.map((feature) => {
            const isSelected = feature.id === activeFeatureId;
            return (
              <button
                key={feature.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => onSelectFeature(feature.id)}
                type="button"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "0.4rem",
                  padding: "0.4rem 0.85rem",
                  borderRadius: "6px",
                  fontSize: "0.875rem",
                  fontWeight: isSelected ? 600 : 500,
                  border: "none",
                  cursor: "pointer",
                  background: isSelected
                    ? "var(--bungalow-color-primary, #6366f1)"
                    : "rgba(255, 255, 255, 0.05)",
                  color: isSelected ? "#ffffff" : "var(--bungalow-text-secondary, #cbd5e1)",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                {feature.iconName ? <Icon name={feature.iconName as IconName} /> : null}
                {feature.name}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

