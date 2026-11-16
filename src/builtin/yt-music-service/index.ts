import { defineApp } from "../../apps/defineApp";
import manifest from "./manifest.json";
import { YouTubeService } from "./models/youtube";

/**
 * The yt-music-service app, built into gondol: YouTube as a music service for the player app
 * (Bungalow's youtube plugin). Its service plays YouTube links in YouTube's embedded player and
 * resolves musik: URIs by searching YouTube (the `yt-music-service` edge function, which uses the
 * signed-in account's YouTube Data API key when it has one). Signing in is an
 * external_service_accounts row (`/music-services/youtube/sign-in`).
 *
 * It depends on the player app: `configureGondol({ apps: [...apps, playerApp, ytMusicServiceApp] })`,
 * and `--builtin …,yt-music-service` for `gondol-api --functions` to write its edge function.
 */
export const ytMusicServiceApp = defineApp({
  manifest,
  pages: {
    youtube: () => import("./features/youtube/src/pages/YouTubeServicePage").then((m) => m.YouTubeServicePage),
  },
  services: {
    youtube: (definition) => new YouTubeService(definition),
  },
});

export default ytMusicServiceApp;
