import { useMemo, type ComponentType } from "react";
import { answer, defineHook, resolutionsOf, useResolutions, type Resolution } from "../apps/contributions";
import { byOrder } from "../apps/shellHooks";
import { getLocalizedText, type AppLocaleString, type IconName } from "../apps/types";
import { MEDIA_KIND_PATTERN } from "./kinds";

export { MEDIA_EXTENSION_PATTERN, MEDIA_KIND_PATTERN, MEDIA_MIME_PATTERN } from "./kinds";

/**
 * Content types of the host's media library: what kinds of file it holds (images, videos, audio,
 * PDFs, …), how a file is recognised as one of them and how it is shown. Apps add their own (3D
 * models, subtitles, fonts, e-books, …) by answering `mediaContentTypesHook`, usually through
 * their manifest's `mediaTypes` (defineApp turns each entry into an answer, and attaches the
 * component in defineApp's `mediaPreviews` that draws it). The library lists, filters, uploads
 * and previews every type that is answered; a type from an app that is off, or tied to a feature
 * the site doesn't offer, goes with it.
 *
 * A type's `kind` is what the library stores for a file (the host's `media.kind`), so pick one that
 * stays: lower-case letters, digits, `-` and `_`, starting with a letter, at most 40 characters.
 * The first answer for a kind wins, so an app can't take over a kind the host or another app
 * already has.
 */

/** What a type's preview draws: a square thumbnail in the library's grid, or the full preview in its sheet. */
export interface MediaPreviewProps {
  /** Where the file is served from: its link, its stored file's address, or an object URL of a file not uploaded yet. */
  src: string | null;
  name: string;
  size: "thumb" | "full";
  /** The file's MIME type, when the library knows it. */
  mimeType?: string | null;
}

export interface MediaContentType {
  /** What is stored for a file of this type (`media.kind`). */
  kind: string;
  /** The name of one file of this type ("3D model"). */
  label: AppLocaleString;
  /** The filter chip's text ("3D models"); `label` when left out. */
  plural?: AppLocaleString;
  iconName: IconName;
  /** MIME types a file of this type has: exact (`model/gltf-binary`) or a whole family (`model/*`). */
  mimeTypes?: string[];
  /** File extensions without the dot (`glb`), for files and links whose MIME type says nothing. */
  extensions?: string[];
  /** Whether files of this type can be uploaded (default true). */
  upload?: boolean;
  /** Whether links to files of this type can be saved (default true). */
  link?: boolean;
  /** Position in the library's filters and type list (ascending; the host's own types come first). */
  order?: number;
  /** Draws a file of this type; without one the library shows the type's icon and name. */
  Preview?: ComponentType<MediaPreviewProps>;
}

export const mediaContentTypesHook = defineHook<MediaContentType>("gondol.mediaContentTypes");

/** Keeps the first type of each kind (and drops ones with an invalid kind), sorted by `order`. */
export function uniqueMediaContentTypes(types: readonly MediaContentType[]): MediaContentType[] {
  const seen = new Set<string>();
  const unique: MediaContentType[] = [];
  for (const type of types) {
    if (!MEDIA_KIND_PATTERN.test(type.kind) || seen.has(type.kind)) continue;
    seen.add(type.kind);
    unique.push(type);
  }
  return byOrder(unique);
}

/** Every content type answered by the host and every registered app, whatever its state. Stable for the page's life. */
export function mediaContentTypes(): MediaContentType[] {
  return uniqueMediaContentTypes(resolutionsOf(mediaContentTypesHook).map((a) => a.value));
}

/** The content types that apply now: the host's, and those of apps that are on and offered by the site. */
export function useMediaContentTypes(): MediaContentType[] {
  const answers = useResolutions(mediaContentTypesHook);
  return useMemo(() => uniqueMediaContentTypes(answers.map((a) => a.value)), [answers]);
}

/** The type of `kind` among `types`. */
export function findMediaContentType(types: readonly MediaContentType[], kind: string | null | undefined): MediaContentType | undefined {
  return kind ? types.find((type) => type.kind === kind) : undefined;
}

/** A type's name (or its plural) in `locale`; a kind no type answers shows as itself. */
export function mediaContentTypeLabel(
  types: readonly MediaContentType[],
  kind: string,
  locale = "en",
  { plural = false }: { plural?: boolean } = {},
): string {
  const type = findMediaContentType(types, kind);
  if (!type) return kind;
  return getLocalizedText(plural ? (type.plural ?? type.label) : type.label, locale);
}

function extensionOf(nameOrUrl: string): string | null {
  const path = nameOrUrl.toLowerCase().split(/[?#]/)[0];
  const match = /\.([a-z0-9_+-]{1,16})$/.exec(path);
  return match ? match[1] : null;
}

/**
 * The type a file or link most likely is: an exact MIME type match first, then a MIME family
 * (`image/*`), then the extension of its name or URL. Types that can't be uploaded (`upload`
 * false) or linked (`link` false) are left out for `via` "upload" or "link". Null when none fits.
 */
export function detectMediaContentType(
  types: readonly MediaContentType[],
  mimeType: string | null | undefined,
  nameOrUrl = "",
  via?: "upload" | "link",
): MediaContentType | null {
  const usable = types.filter((type) => (via === "upload" ? type.upload !== false : via === "link" ? type.link !== false : true));
  const mime = (mimeType ?? "").toLowerCase().split(";")[0].trim();
  if (mime) {
    const exact = usable.find((type) => type.mimeTypes?.some((m) => m.toLowerCase() === mime));
    if (exact) return exact;
    const family = mime.split("/")[0];
    const wildcard = usable.find((type) => type.mimeTypes?.some((m) => m.toLowerCase() === `${family}/*`));
    if (wildcard) return wildcard;
  }
  const extension = extensionOf(nameOrUrl);
  if (extension) {
    const byExtension = usable.find((type) => type.extensions?.some((e) => e.toLowerCase() === extension));
    if (byExtension) return byExtension;
  }
  return null;
}

/** An `<input type="file" accept>` value for every type that can be uploaded: MIME types and `.ext`s. */
export function mediaAcceptAttribute(types: readonly MediaContentType[]): string {
  const accept = new Set<string>();
  for (const type of types) {
    if (type.upload === false) continue;
    for (const mime of type.mimeTypes ?? []) accept.add(mime.toLowerCase());
    for (const extension of type.extensions ?? []) accept.add(`.${extension.toLowerCase()}`);
  }
  return [...accept].join(",");
}

/**
 * The MIME type to store a file of `type` with: the file's own when it has one, else the type's
 * first exact MIME type, else `application/octet-stream`.
 */
export function mediaUploadContentType(type: MediaContentType | null | undefined, fileType: string | null | undefined): string {
  if (fileType) return fileType;
  const exact = type?.mimeTypes?.find((mime) => !mime.endsWith("/*"));
  return exact ?? "application/octet-stream";
}

/** A manifest's `mediaTypes` entry (the manifest schema validates it). */
export interface ManifestMediaType {
  kind: string;
  label: AppLocaleString;
  plural?: AppLocaleString;
  iconName: string;
  mimeTypes?: string[];
  extensions?: string[];
  upload?: boolean;
  link?: boolean;
  order?: number;
  /** The feature it goes with: a site that doesn't offer the feature doesn't get the type. */
  feature?: string;
}

/**
 * Answers to `mediaContentTypesHook` for a manifest's `mediaTypes`, each with its preview from
 * `previews` (by kind). defineApp calls it; a bundle built by hand can too.
 */
export function mediaContentTypeResolutions(
  appId: string,
  mediaTypes: readonly ManifestMediaType[] | undefined,
  previews: Partial<Record<string, ComponentType<MediaPreviewProps>>> = {},
): Resolution<MediaContentType>[] {
  const kinds = new Set((mediaTypes ?? []).map((type) => type.kind));
  for (const kind of Object.keys(previews)) {
    if (!kinds.has(kind)) throw new Error(`app "${appId}": a media preview for "${kind}", which its manifest's mediaTypes doesn't declare`);
  }
  return (mediaTypes ?? []).map(({ feature, iconName, ...type }) => {
    const Preview = previews[type.kind];
    return answer(mediaContentTypesHook, { ...type, iconName: iconName as IconName, ...(Preview ? { Preview } : {}) }, { featureId: feature });
  });
}
