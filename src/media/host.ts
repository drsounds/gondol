import type { ComponentType } from "react";
import { defineHook, resolutionsOf } from "../apps/contributions";

/**
 * The host's media library, as gondol's built-in apps use it: images to pick (a playlist's header
 * image, an agent's avatar), where a stored file is served from, and entities' covers. gondol has
 * no media library of its own, so the host answers `mediaHostHook` (`configureGondol({ resolutions })`);
 * without an answer the apps simply show no images and offer no pickers.
 */

/** An entity's cover slots (the `covers` table, keyed by entity type + id). */
export type CoverSlot = "header_image" | "vertical_cover_image" | "horizontal_cover_image" | "square_cover_image";

/** One cover image: the media row it is and where it's served from. */
export interface CoverImage {
  mediaId: string;
  name: string;
  src: string | null;
}

export type EntityCovers = Partial<Record<CoverSlot, CoverImage>>;

/** An image of the user's media library. */
export interface MediaImage {
  id: string;
  name: string;
  src: string | null;
}

/** Where a stored file is: what a SECURITY DEFINER function returns for another user's covers. */
export interface MediaFileLocation {
  source: string;
  provider?: string | null;
  url: string | null;
  storage_path: string | null;
}

export interface MediaHost {
  /** The user's images (newest first), loaded once and shared. */
  useImages(): { data?: MediaImage[]; isLoading?: boolean };
  /** The covers of the entity behind `uri` (empty while loading or when it has none). */
  useEntityCovers(uri: string | null | undefined): EntityCovers;
  /** Sets (or clears, with null) an entity's cover images; slots left out keep their image. */
  useSetEntityCovers(): {
    mutateAsync(input: { uri: string; covers: Partial<Record<CoverSlot, string | null>> }): Promise<unknown>;
  };
  /** The address a stored file is served from (null while it can't be shown). */
  mediaSrc(file: MediaFileLocation): string | null;
  /** A grid of the user's images to pick one from (uploading one on the spot, where the host can). */
  ImagePicker?: ComponentType<{ value: string | null; onChange: (mediaId: string) => void }>;
  /** An image in a cover slot's aspect ratio. */
  CoverFrame?: ComponentType<{ slot: CoverSlot; src: string | null; label: string; small?: boolean }>;
  /** A field picking one of the user's media files of some `kinds` ("image", "video", …). */
  MediaPicker?: ComponentType<{
    label: string;
    hint?: string;
    kinds: readonly string[];
    value: string | null;
    onChange: (mediaId: string | null) => void;
  }>;
}

export const mediaHostHook = defineHook<Partial<MediaHost>>("gondol.mediaHost");

const NO_COVERS: EntityCovers = {};
const NO_IMAGES = { data: [] as MediaImage[], isLoading: false };
const NOTHING_TO_SET = { mutateAsync: async () => undefined };

const DEFAULTS: MediaHost = {
  useImages: () => NO_IMAGES,
  useEntityCovers: () => NO_COVERS,
  useSetEntityCovers: () => NOTHING_TO_SET,
  mediaSrc: (file) => (file.source === "link" ? file.url : null),
};

/** Every answer to `mediaHostHook`, merged over the defaults (later answers win). Stable for the page's life. */
export function mediaHost(): MediaHost {
  return Object.assign({}, DEFAULTS, ...resolutionsOf(mediaHostHook).map((a) => a.value)) as MediaHost;
}
