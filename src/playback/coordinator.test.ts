import { describe, expect, test } from "bun:test";
import { ServiceManager } from "../services/service";
import { PlaybackCoordinator, memoryResolutionStore } from "./coordinator";
import { BaseMediaService } from "./support";
import type { Candidate, MusicService, PlayRequest } from "./types";

class FakeService extends BaseMediaService implements MusicService {
  loaded: string[] = [];
  constructor(id: string, private readonly answer: (request: PlayRequest) => Candidate[], hosts: string[] = []) {
    super({ id, name: id, aspects: ["media", "music"], hosts });
  }
  async findCandidates(request: PlayRequest) {
    return this.answer(request);
  }
  loadByIsrc(isrc: string) {
    this.loaded.push(`isrc:${isrc}`);
  }
  loadByTitleArtist(title: string, artist?: string) {
    this.loaded.push(`ta:${title}|${artist ?? ""}`);
  }
  loadUri(uri: string) {
    this.loaded.push(uri);
  }
  play() {
    this.setState("playing");
  }
  pause() {
    this.setState("paused");
  }
  stop() {
    this.setState("stopped");
  }
  seek(ms: number) {
    this.setPosition(ms, this.durationMs);
  }
  end() {
    this.playback.completed();
  }
}

function setup() {
  const services = new ServiceManager();
  const local = new FakeService("local", (r) => (r.isrc === "SE1" ? [{ title: "By ISRC", byIsrc: true }] : []));
  const tube = new FakeService("tube", (r) => (r.title ? [{ uri: `tube:${r.title}`, title: `${r.title} (video)`, byIsrc: false }] : []), ["tube.example"]);
  services.register(local);
  services.register(tube);
  const coordinator = new PlaybackCoordinator(services);
  coordinator.setResolutionStore(memoryResolutionStore());
  return { services, local, tube, coordinator };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("playback coordinator", () => {
  test("a link a service plays as it is goes straight there", async () => {
    const { coordinator, tube } = setup();
    await coordinator.playUri("https://www.tube.example/watch?v=1");
    expect(tube.loaded).toEqual(["https://www.tube.example/watch?v=1"]);
    expect(coordinator.getSnapshot().activeServiceId).toBe("tube");
    expect(coordinator.getSnapshot().state).toBe("playing");
  });

  test("a musik: URI asks which match to play, and remembers 'always'", async () => {
    const { coordinator, tube } = setup();
    const first = coordinator.playUri("musik:track?name=Song&artist_name=Band");
    await tick();
    await tick();
    const choice = coordinator.getSnapshot().choice;
    expect(choice?.matches.map((m) => m.serviceId)).toEqual(["tube"]);
    choice!.answer({ match: choice!.matches[0], always: true });
    await first;
    expect(tube.loaded).toEqual(["tube:Song"]);
    // The second time, the saved choice plays without asking.
    await coordinator.playUri("musik:track?name=Song&artist_name=Band");
    expect(coordinator.getSnapshot().choice).toBeNull();
    expect(tube.loaded).toEqual(["tube:Song", "tube:Song"]);
  });

  test("an ISRC resolves on the service that knows it", async () => {
    const { coordinator, local } = setup();
    const playing = coordinator.playUri("musik:isrc:SE1");
    await tick();
    await tick();
    const choice = coordinator.getSnapshot().choice!;
    expect(choice.matches.map((m) => m.serviceId)).toEqual(["local"]);
    choice.answer({ match: choice.matches[0], always: false });
    await playing;
    expect(local.loaded).toEqual(["isrc:SE1"]);
  });

  test("the queue moves on by itself without asking, and stops at the end", async () => {
    const { coordinator, tube } = setup();
    await coordinator.playQueue([
      { uri: "https://tube.example/a", title: "A" },
      { uri: "musik:track?name=B", title: "B" },
    ]);
    expect(coordinator.getSnapshot().index).toBe(0);
    tube.end();
    await tick();
    await tick();
    expect(coordinator.getSnapshot().index).toBe(1);
    expect(coordinator.getSnapshot().choice).toBeNull();
    expect(tube.loaded).toEqual(["https://tube.example/a", "tube:B"]);
    tube.end();
    await tick();
    expect(coordinator.getSnapshot().state).toBe("stopped");
  });

  test("nothing to play with is an error, not a choice", async () => {
    const { coordinator } = setup();
    await coordinator.playUri("musik:isrc:NOPE");
    expect(coordinator.getSnapshot().error).toBe("unplayable");
  });

  test("repeat one and previous", async () => {
    const { coordinator, tube } = setup();
    await coordinator.playQueue([
      { uri: "https://tube.example/a", title: "A" },
      { uri: "https://tube.example/b", title: "B" },
    ], 1);
    coordinator.cycleRepeat();
    coordinator.cycleRepeat();
    expect(coordinator.getSnapshot().repeat).toBe("one");
    tube.end();
    await tick();
    expect(coordinator.getSnapshot().index).toBe(1);
    coordinator.previous();
    await tick();
    expect(coordinator.getSnapshot().index).toBe(0);
  });

  test("a service that goes away stops being the active one", async () => {
    const { coordinator, services } = setup();
    await coordinator.playUri("https://tube.example/a");
    services.unregister("tube");
    expect(coordinator.getSnapshot().activeServiceId).toBeNull();
  });
});
