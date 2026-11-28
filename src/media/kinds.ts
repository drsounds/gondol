/** What the media library's content types (./contentTypes.ts) may be called; no imports, so the manifest schema can use it on the server. */

/** A valid `kind`. */
export const MEDIA_KIND_PATTERN = /^[a-z][a-z0-9_-]{0,39}$/;

/** A valid MIME type or family (`type/subtype`, `type/*`). */
export const MEDIA_MIME_PATTERN = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/(\*|[a-z0-9][a-z0-9!#$&^_.+-]*)$/;

/** A valid extension (no dot). */
export const MEDIA_EXTENSION_PATTERN = /^[a-z0-9][a-z0-9_+-]{0,15}$/;
