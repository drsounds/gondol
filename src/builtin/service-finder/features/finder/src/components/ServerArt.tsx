import { useState } from "react";
import { Icon } from "../../../../../../design-system/bungalow-79d923";
import { serverIcon, type RegistryServer } from "../../../../models";

/** A server's icon from the registry, or a compass when it has none (or it doesn't load). */
export function ServerArt({ server, size = "sm" }: { server: RegistryServer; size?: "sm" | "lg" }) {
  const src = serverIcon(server);
  const [failed, setFailed] = useState(false);
  return (
    <span className={`service-finder__art service-finder__art--${size}`} aria-hidden="true">
      {src && !failed ? <img src={src} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <Icon name="compass" />}
    </span>
  );
}
