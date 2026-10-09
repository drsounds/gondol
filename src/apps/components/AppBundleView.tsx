import { useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import type { InternalAppBundle } from "../types";
import { useAppActivation } from "../hooks";
import { AppFeatureNav } from "./AppFeatureNav";
import { AppDeactivatedNotice } from "./AppDeactivatedNotice";

export function AppBundleView({
  app,
  splat,
  onBackToApps,
  ...extraProps
}: {
  app: InternalAppBundle;
  splat: string;
  onBackToApps: () => void;
  [key: string]: unknown;
}) {
  const navigate = useNavigate();
  const { isActive, activate, toggle } = useAppActivation(app.id, app.defaultActive ?? true);

  // Parse feature ID and remaining subpath from splat (e.g. "banking" or "entries/new")
  const { activeFeature, subpath } = useMemo(() => {
    const cleanSplat = splat.replace(/^\/+|\/+$/g, "");
    const parts = cleanSplat.split("/");
    const requestedFeatureId = parts[0];

    const found = app.features.find((f) => f.id === requestedFeatureId);
    if (found) {
      return {
        activeFeature: found,
        subpath: parts.slice(1).join("/"),
      };
    }

    const defaultFeature =
      app.features.find((f) => f.id === app.defaultFeatureId) ?? app.features[0];
    return {
      activeFeature: defaultFeature,
      subpath: cleanSplat,
    };
  }, [app, splat]);

  const handleSelectFeature = (featureId: string) => {
    navigate({
      to: `/app/${app.id}/${featureId}`,
    } as Parameters<typeof navigate>[0]);
  };

  const handleNavigateFeature = (featureId: string, featureSubpath?: string) => {
    const target = featureSubpath
      ? `/app/${app.id}/${featureId}/${featureSubpath}`
      : `/app/${app.id}/${featureId}`;
    navigate({
      to: target,
    } as Parameters<typeof navigate>[0]);
  };

  const FeatureComponent = activeFeature?.Page;

  return (
    <div
      className="app-bundle-view"
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: "100%",
        width: "100%",
      }}
    >
      <AppFeatureNav
        app={app}
        activeFeatureId={activeFeature?.id ?? ""}
        isActive={isActive}
        onSelectFeature={handleSelectFeature}
        onToggleActive={toggle}
        onBackToApps={onBackToApps}
      />

      <div
        className="app-bundle-content"
        style={{
          flex: 1,
          padding: "1rem",
        }}
      >
        {!isActive ? (
          <AppDeactivatedNotice
            app={app}
            onActivate={activate}
            onBackToApps={onBackToApps}
          />
        ) : FeatureComponent ? (
          <FeatureComponent
            appId={app.id}
            featureId={activeFeature.id}
            splat={subpath}
            onNavigateFeature={handleNavigateFeature}
            {...extraProps}
          />
        ) : (
          <div className="muted" style={{ padding: "2rem", textAlign: "center" }}>
            No feature selected or available.
          </div>
        )}
      </div>
    </div>
  );
}
