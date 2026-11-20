import { describe, expect, test } from "bun:test";
import { formatMusikUri, isMusikUri, isrcOf, musikLabel, musikRecording, parseMusikUri } from "./musikUri";
import { musikPlayRequest } from "./types";

// The cases of Bungalow's MusikUriTest (RFC-0002).
describe("musik: identifier forms", () => {
  test("an ISRC round-trips", () => {
    const m = parseMusikUri("musik:isrc:GBAYE0601498");
    expect(m?.kind).toBe("isrc");
    expect(m?.id).toBe("GBAYE0601498");
    expect(formatMusikUri(m!)).toBe("musik:isrc:GBAYE0601498");
  });
  test("an ISRC is normalized", () => {
    expect(formatMusikUri({ kind: "isrc", id: "gb-aye-06-01498", trackNumber: 0 })).toBe("musik:isrc:GBAYE0601498");
  });
  test("other standard ids", () => {
    expect(parseMusikUri("musik:iswc:T0345246800")?.kind).toBe("iswc");
    expect(parseMusikUri("musik:upc:00602557091936")?.kind).toBe("upc");
    expect(parseMusikUri("musik:isni:000000012146438X")?.kind).toBe("isni");
    expect(parseMusikUri("musik:ipi:00016860138")?.kind).toBe("ipi");
  });
  test("genres and moods are slugged", () => {
    expect(formatMusikUri({ kind: "genre", id: "Drum & Bass", trackNumber: 0 })).toBe("musik:genre:drum-bass");
    expect(formatMusikUri({ kind: "mood", id: "Melancholic", trackNumber: 0 })).toBe("musik:mood:melancholic");
    expect(parseMusikUri("musik:genre:drum-bass")).toMatchObject({ kind: "genre", id: "drum-bass" });
  });
});

describe("musik: name form", () => {
  test("an artist", () => {
    const m = parseMusikUri("musik:artist:Aphex%20Twin");
    expect(m).toMatchObject({ kind: "artist", artist: "Aphex Twin" });
    expect(formatMusikUri(m!)).toBe("musik:artist:Aphex%20Twin");
  });
  test("a release", () => {
    const m = parseMusikUri("musik:artist:Aphex%20Twin:release:Drukqs");
    expect(m).toMatchObject({ kind: "release", release: "Drukqs" });
    expect(formatMusikUri(m!)).toBe("musik:artist:Aphex%20Twin:release:Drukqs");
  });
  test("a recording with its position and version round-trips exactly", () => {
    const uri = "musik:artist:Radiohead:release:OK%20Computer:track:5:name:Karma%20Police:version:Live";
    const m = parseMusikUri(uri);
    expect(m).toMatchObject({ kind: "recording", artist: "Radiohead", release: "OK Computer", trackNumber: 5, name: "Karma Police", version: "Live" });
    expect(formatMusikUri(m!)).toBe(uri);
  });
  test("a recording without a track number", () => {
    expect(parseMusikUri("musik:artist:Radiohead:release:OK%20Computer:name:Karma%20Police")).toMatchObject({ kind: "recording", trackNumber: 0, name: "Karma Police" });
  });
  test("encoded delimiters survive a round trip", () => {
    const built = musikRecording({ artist: "AC/DC", release: "Who Made Who: OST", trackNumber: 3, name: "D.T." });
    expect(parseMusikUri(formatMusikUri(built))).toMatchObject({ artist: "AC/DC", release: "Who Made Who: OST", name: "D.T." });
  });
});

describe("musik: query form", () => {
  test("resolves like the name form", () => {
    expect(parseMusikUri("musik:track?name=Karma%20Police&artist_name=Radiohead&release_name=OK%20Computer&number=5")).toMatchObject({
      kind: "recording",
      name: "Karma Police",
      artist: "Radiohead",
      release: "OK Computer",
      trackNumber: 5,
    });
  });
  test("needs a name", () => {
    expect(parseMusikUri("musik:track?artist_name=Radiohead")).toBeNull();
  });
  test("a recording without a release renders as a query", () => {
    expect(formatMusikUri(musikRecording({ artist: "Radiohead", name: "Karma Police" })).startsWith("musik:track?name=Karma%20Police")).toBe(true);
  });
});

describe("musik: legacy and playback", () => {
  test("the legacy recording URI parses as an ISRC", () => {
    expect(parseMusikUri("spacify:recording:isrc:GBAYE0601498")).toMatchObject({ kind: "isrc", id: "GBAYE0601498" });
    expect(isrcOf("spacify:recording:isrc:GBAYE0601498")).toBe("GBAYE0601498");
  });
  test("content URIs", () => {
    expect(isMusikUri("musik:isrc:X")).toBe(true);
    expect(isMusikUri("spacify:recording:isrc:X")).toBe(true);
    expect(isMusikUri("spacify:playlist:123")).toBe(false);
    expect(isMusikUri(null)).toBe(false);
  });
  test("an ISRC plays by ISRC", () => {
    expect(musikPlayRequest("musik:isrc:GBAYE0601498")).toMatchObject({ isrc: "GBAYE0601498", uri: "musik:isrc:GBAYE0601498" });
  });
  test("a recording plays by its metadata", () => {
    const request = musikPlayRequest("musik:artist:Radiohead:release:OK%20Computer:track:5:name:Karma%20Police");
    expect(request?.isrc).toBeUndefined();
    expect(request).toMatchObject({ title: "Karma Police", artist: "Radiohead" });
  });
  test("forms that aren't one item don't play", () => {
    expect(musikPlayRequest("musik:artist:Radiohead")).toBeNull();
    expect(musikPlayRequest("musik:genre:rock")).toBeNull();
    expect(musikPlayRequest("musik:upc:00602557091936")).toBeNull();
    expect(musikPlayRequest("spacify:playlist:123")).toBeNull();
  });
  test("malformed input", () => {
    expect(parseMusikUri(null)).toBeNull();
    expect(parseMusikUri("musik:")).toBeNull();
    expect(parseMusikUri("musik:isrc:")).toBeNull();
    expect(parseMusikUri("musik:nope:1")).toBeNull();
  });
  test("labels", () => {
    expect(musikLabel("musik:track?name=Karma%20Police&artist_name=Radiohead")).toBe("Karma Police — Radiohead");
    expect(musikLabel("musik:isrc:GBAYE0601498")).toBe("ISRC GBAYE0601498");
  });
});
