import { Alert, Button, Card } from "../../design-system/bungalow-79d923";
import type { InternalAppBundle } from "../types";

export function AppDeactivatedNotice({
  app,
  onActivate,
  onBackToApps,
}: {
  app: InternalAppBundle;
  onActivate: () => void;
  onBackToApps: () => void;
}) {
  return (
    <Card>
      <div className="stack" style={{ padding: "1.5rem", textAlign: "center", alignItems: "center" }}>
        <div style={{ fontSize: "2rem", marginBottom: "0.5rem" }}>🔌</div>
        <h2 className="panel-title" style={{ margin: 0 }}>
          {app.name} is Inactive
        </h2>
        <p className="stat-label" style={{ maxWidth: "32rem", margin: "0 auto" }}>
          This internal bundle is currently deactivated. Activate this app to access its{" "}
          {app.features.length} features ({app.features.map((f) => f.name).join(", ")}).
        </p>
        <div style={{ display: "flex", gap: "0.75rem", marginTop: "1rem" }}>
          <Button tone="primary" onClick={onActivate}>
            Activate App
          </Button>
          <Button variant="outline" onClick={onBackToApps}>
            Back to Apps
          </Button>
        </div>
      </div>
    </Card>
  );
}

