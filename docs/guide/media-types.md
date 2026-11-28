# Media content types

gondol has no media library of its own: the host has one (spacify's `/media`) and hands it to
gondol's apps through `mediaHostHook` (`gondol/media/host`). What kinds of file that library holds
is a hook of its own, `mediaContentTypesHook` (`gondol/media/contentTypes`), so any app can add a
content type (3D models, subtitles, fonts, e-books, …) without the host knowing it. The library
then lists, filters, uploads, links and previews files of that type like its own images and videos.

## Declaring a type

In the app's `manifest.json`:

```json
"mediaTypes": [
  {
    "kind": "model3d",
    "label": { "en": "3D model", "sv": "3D-modell" },
    "plural": { "en": "3D models", "sv": "3D-modeller" },
    "iconName": "box",
    "mimeTypes": ["model/gltf-binary", "model/gltf+json"],
    "extensions": ["glb", "gltf"],
    "feature": "models"
  }
]
```

| Field | Meaning |
| --- | --- |
| `kind` | What the library stores for a file of this type (`media.kind`): lower-case letters, digits, `-` and `_`, starting with a letter, at most 40 characters. Keep it stable; files keep it after the app is gone. |
| `label`, `plural` | The name of one file, and the library filter's text (`label` when left out). |
| `iconName` | The glyph shown for a file without a preview. |
| `mimeTypes` | Exact MIME types or families (`model/*`). |
| `extensions` | Extensions without the dot, for files and links whose MIME type says nothing. At least one MIME type or extension is required. |
| `upload`, `link` | Whether files of the type can be uploaded, and links to them saved (both default true). |
| `order` | Position in the filters and the type list. |
| `feature` | The feature it goes with: a site that doesn't offer that feature doesn't get the type. |

A file is matched to a type by its exact MIME type first, then a MIME family, then its extension
(`detectMediaContentType()`). The first answer for a kind wins, so an app can't take over a kind
the host or another app already has.

## Drawing it

Without code the library shows the type's icon and name. To draw a file, attach a component in
`defineApp`; `lazyWidget` keeps it out of the first load:

```ts
export default defineApp({
  manifest,
  pages: { models: () => import("./pages/ModelsPage").then((m) => m.ModelsPage) },
  mediaPreviews: {
    model3d: lazyWidget(() => import("./components/ModelPreview").then((m) => m.ModelPreview)),
  },
});
```

The component gets `MediaPreviewProps`: `src` (the link, the stored file's address or an object
URL of a file not uploaded yet; null while there is nothing to show), `name`, `size` (`thumb`, a
square tile in the grid, or `full`, the sheet's preview) and `mimeType`. The sheet's preview pane is
always dark, so draw with the theme's `--bungalow-color-*` tokens.

## Reading the types

- `useMediaContentTypes()`: the types that apply now (the host's and those of apps that are on and
  offered by the site), sorted by `order`.
- `mediaContentTypes()`: every registered type, for code outside React.
- `detectMediaContentType(types, mimeType, nameOrUrl, via?)`, `mediaAcceptAttribute(types)` (an
  `<input accept>` value), `mediaContentTypeLabel(types, kind, locale)` and
  `mediaUploadContentType(type, file.type)` (the MIME type to store a file with).
- An app built by hand rather than with `defineApp` answers the hook with
  `mediaContentTypeResolutions(appId, manifest.mediaTypes, previews)`.

The host declares its own types the same way (spacify's media app declares images, videos, audio
and PDFs in its manifest). Storage is the host's business: it must accept the new MIME types
(spacify's bucket accepts any type but HTML) and may limit which hosting providers take a type.
