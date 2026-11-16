import { Navigate } from "@tanstack/react-router";
import type { AppFeaturePageProps } from "../../../../../../apps/types";

/** `/youtube-music-service`: YouTube is listed with the other services, at /music-services. */
export function YouTubeServicePage(_props: AppFeaturePageProps) {
  return <Navigate to={"/music-services" as never} replace />;
}
