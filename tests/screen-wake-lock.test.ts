import { describe, expect, it, vi } from "vitest";
import {
  ScreenWakeLockController,
  ScreenWakeLockSentinelLike,
  ScreenWakeLockTarget
} from "../src/screen-wake-lock";

class FakeSentinel implements ScreenWakeLockSentinelLike {
  released = false;
  release = vi.fn(async () => {
    if (this.released) {
      return;
    }
    this.released = true;
    this.releaseListeners.forEach((listener) => listener());
  });
  private readonly releaseListeners = new Set<() => void>();

  addEventListener(_type: "release", listener: () => void): void {
    this.releaseListeners.add(listener);
  }

  removeEventListener(_type: "release", listener: () => void): void {
    this.releaseListeners.delete(listener);
  }

  releaseFromPlatform(): void {
    this.released = true;
    this.releaseListeners.forEach((listener) => listener());
  }
}

class FakeTarget implements ScreenWakeLockTarget {
  visibilityState: DocumentVisibilityState = "visible";
  readonly sentinels: FakeSentinel[] = [];
  request = vi.fn(async (): Promise<FakeSentinel> => {
    const sentinel = new FakeSentinel();
    this.sentinels.push(sentinel);
    return sentinel;
  });
  private readonly visibilityListeners = new Set<() => void>();

  addVisibilityListener(listener: () => void): void {
    this.visibilityListeners.add(listener);
  }

  removeVisibilityListener(listener: () => void): void {
    this.visibilityListeners.delete(listener);
  }

  setVisibility(visibilityState: DocumentVisibilityState): void {
    this.visibilityState = visibilityState;
    this.visibilityListeners.forEach((listener) => listener());
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

describe("ScreenWakeLockController", () => {
  it("requests on playback start and releases on stop", async () => {
    const target = new FakeTarget();
    const controller = new ScreenWakeLockController();

    await controller.start(target);
    expect(target.request).toHaveBeenCalledTimes(1);

    await controller.stop();
    expect(target.sentinels[0].release).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the platform target is unavailable", async () => {
    const controller = new ScreenWakeLockController();

    await controller.start(null);
    await controller.stop();
  });

  it("releases while hidden and reacquires after visibility returns", async () => {
    const target = new FakeTarget();
    const controller = new ScreenWakeLockController();

    await controller.start(target);
    target.setVisibility("hidden");
    await Promise.resolve();
    expect(target.sentinels[0].release).toHaveBeenCalledTimes(1);

    target.setVisibility("visible");
    await Promise.resolve();
    expect(target.request).toHaveBeenCalledTimes(2);
  });

  it("does not reacquire after playback stops", async () => {
    const target = new FakeTarget();
    const controller = new ScreenWakeLockController();

    await controller.start(target);
    await controller.stop();
    target.setVisibility("hidden");
    target.setVisibility("visible");
    await Promise.resolve();

    expect(target.request).toHaveBeenCalledTimes(1);
  });

  it("releases a stale request that resolves after stop", async () => {
    const target = new FakeTarget();
    const request = deferred<FakeSentinel>();
    target.request.mockImplementationOnce(() => request.promise);
    const controller = new ScreenWakeLockController();

    const starting = controller.start(target);
    await Promise.resolve();
    expect(target.request).toHaveBeenCalledTimes(1);
    await controller.stop();
    const sentinel = new FakeSentinel();
    request.resolve(sentinel);
    await starting;

    expect(sentinel.release).toHaveBeenCalledTimes(1);
  });

  it("releases a pending lock from a replaced playback document", async () => {
    const firstTarget = new FakeTarget();
    const secondTarget = new FakeTarget();
    const request = deferred<FakeSentinel>();
    firstTarget.request.mockImplementationOnce(() => request.promise);
    const controller = new ScreenWakeLockController();

    const firstStart = controller.start(firstTarget);
    await Promise.resolve();
    const secondStart = controller.start(secondTarget);
    const staleSentinel = new FakeSentinel();
    request.resolve(staleSentinel);
    await Promise.all([firstStart, secondStart]);

    expect(staleSentinel.release).toHaveBeenCalledTimes(1);
    expect(secondTarget.request).toHaveBeenCalledTimes(1);
  });

  it("releases and reacquires when the preference changes during playback", async () => {
    const target = new FakeTarget();
    const controller = new ScreenWakeLockController();

    await controller.start(target);
    await controller.setEnabled(false);
    expect(target.sentinels[0].release).toHaveBeenCalledTimes(1);

    await controller.setEnabled(true);
    expect(target.request).toHaveBeenCalledTimes(2);
  });

  it("reports request rejection once per controller session", async () => {
    const target = new FakeTarget();
    target.request.mockRejectedValue(new Error("battery saver"));
    const onRejected = vi.fn();
    const controller = new ScreenWakeLockController(onRejected);

    await controller.start(target);
    target.setVisibility("hidden");
    target.setVisibility("visible");
    await Promise.resolve();

    expect(target.request).toHaveBeenCalledTimes(2);
    expect(onRejected).toHaveBeenCalledTimes(1);
  });

  it("does not retry an externally released lock until visibility changes", async () => {
    const target = new FakeTarget();
    const controller = new ScreenWakeLockController();

    await controller.start(target);
    target.sentinels[0].releaseFromPlatform();
    await Promise.resolve();
    expect(target.request).toHaveBeenCalledTimes(1);

    target.setVisibility("hidden");
    target.setVisibility("visible");
    await Promise.resolve();
    expect(target.request).toHaveBeenCalledTimes(2);
  });
});
