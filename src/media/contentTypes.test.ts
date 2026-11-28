import { describe, expect, test } from "bun:test";
import {
  detectMediaContentType,
  mediaAcceptAttribute,
  mediaContentTypeLabel,
  mediaContentTypeResolutions,
  mediaUploadContentType,
  uniqueMediaContentTypes,
  type MediaContentType,
} from "./contentTypes";
import { parseManifest } from "../apps/manifest";

const image: MediaContentType = { kind: "image", label: { en: "Image", sv: "Bild" }, iconName: "image", mimeTypes: ["image/*"], extensions: ["png", "jpg"], order: 0 };
const svg: MediaContentType = { kind: "vector", label: { en: "Vector" }, iconName: "image", mimeTypes: ["image/svg+xml"], extensions: ["svg"], order: 5 };
const model: MediaContentType = { kind: "model3d", label: { en: "3D model" }, plural: { en: "3D models", sv: "3D-modeller" }, iconName: "box", mimeTypes: ["model/gltf-binary"], extensions: ["glb", "gltf"] };
const linkOnly: MediaContentType = { kind: "stream", label: { en: "Stream" }, iconName: "play", extensions: ["m3u8"], upload: false };
const types = uniqueMediaContentTypes([image, svg, model, linkOnly]);

describe("media content types", () => {
  test("an exact MIME type beats a family, which beats an extension", () => {
    expect(detectMediaContentType(types, "image/svg+xml", "a.png")?.kind).toBe("vector");
    expect(detectMediaContentType(types, "image/png", "a.svg")?.kind).toBe("image");
    expect(detectMediaContentType(types, "", "https://x.test/robot.GLB?v=2")?.kind).toBe("model3d");
    expect(detectMediaContentType(types, "application/octet-stream", "robot.glb")?.kind).toBe("model3d");
    expect(detectMediaContentType(types, "text/plain", "notes.txt")).toBeNull();
  });

  test("types that can't be uploaded are left out of uploads and the accept list", () => {
    expect(detectMediaContentType(types, null, "live.m3u8", "upload")).toBeNull();
    expect(detectMediaContentType(types, null, "live.m3u8", "link")?.kind).toBe("stream");
    expect(mediaAcceptAttribute(types)).toBe("image/*,.png,.jpg,image/svg+xml,.svg,model/gltf-binary,.glb,.gltf");
  });

  test("the first answer of a kind wins, invalid kinds are dropped, order sorts", () => {
    const merged = uniqueMediaContentTypes([model, { ...image, label: { en: "Other" } }, image, { ...model, kind: "Bad Kind" }]);
    expect(merged.map((t) => t.kind)).toEqual(["image", "model3d"]);
    expect(mediaContentTypeLabel(merged, "image", "en")).toBe("Other");
    expect(mediaContentTypeLabel(merged, "model3d", "sv", { plural: true })).toBe("3D-modeller");
    expect(mediaContentTypeLabel(merged, "unknown")).toBe("unknown");
  });

  test("upload content type falls back to the type's exact MIME type", () => {
    expect(mediaUploadContentType(model, "")).toBe("model/gltf-binary");
    expect(mediaUploadContentType(image, "")).toBe("application/octet-stream");
    expect(mediaUploadContentType(model, "model/gltf+json")).toBe("model/gltf+json");
  });
});

describe("manifest mediaTypes", () => {
  const base = { id: "models", slug: "models", name: { en: "Models" }, description: { en: "3D" }, iconName: "box", defaultFeatureId: "models", features: [{ id: "models", name: { en: "Models" }, path: "models", iconName: "box" }] };

  test("valid entries become answers, with previews attached by kind", () => {
    const manifest = parseManifest({ ...base, mediaTypes: [{ kind: "model3d", label: { en: "3D model" }, iconName: "box", extensions: ["glb"], feature: "models" }] });
    const Preview = () => null;
    const [resolution] = mediaContentTypeResolutions(manifest.id, manifest.mediaTypes, { model3d: Preview });
    expect(resolution.value.kind).toBe("model3d");
    expect(resolution.value.Preview).toBe(Preview);
    expect(resolution.featureId).toBe("models");
    expect(() => mediaContentTypeResolutions(manifest.id, manifest.mediaTypes, { other: Preview })).toThrow(/doesn't declare/);
  });

  test("bad entries fail the manifest", () => {
    expect(() => parseManifest({ ...base, mediaTypes: [{ kind: "3d", label: { en: "x" }, iconName: "box", extensions: ["glb"] }] })).toThrow(/kind/);
    expect(() => parseManifest({ ...base, mediaTypes: [{ kind: "model", label: { en: "x" }, iconName: "box" }] })).toThrow(/MIME type or extension/);
    expect(() => parseManifest({ ...base, mediaTypes: [{ kind: "a", label: { en: "x" }, iconName: "box", extensions: ["a"] }, { kind: "a", label: { en: "y" }, iconName: "box", extensions: ["b"] }] })).toThrow(/duplicate media kind/);
    expect(() => parseManifest({ ...base, mediaTypes: [{ kind: "a", label: { en: "x" }, iconName: "box", extensions: ["a"], feature: "nope" }] })).toThrow(/no feature/);
  });
});
