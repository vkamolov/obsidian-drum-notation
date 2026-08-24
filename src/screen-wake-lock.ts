export interface ScreenWakeLockSentinelLike {
  readonly released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
  removeEventListener(type: "release", listener: () => void): void;
}

export interface ScreenWakeLockTarget {
  readonly visibilityState: DocumentVisibilityState;
  request(): Promise<ScreenWakeLockSentinelLike>;
  addVisibilityListener(listener: () => void): void;
  removeVisibilityListener(listener: () => void): void;
}

export function createScreenWakeLockTarget(doc: Document): ScreenWakeLockTarget | null {
  const activeWindow = doc.defaultView;
  const wakeLock = activeWindow?.navigator.wakeLock;

  if (!activeWindow?.isSecureContext || !wakeLock) {
    return null;
  }

  return {
    get visibilityState() {
      return doc.visibilityState;
    },
    request: () => wakeLock.request("screen"),
    addVisibilityListener: (listener) => doc.addEventListener("visibilitychange", listener),
    removeVisibilityListener: (listener) => doc.removeEventListener("visibilitychange", listener)
  };
}

export function isScreenWakeLockSupported(doc: Document): boolean {
  return createScreenWakeLockTarget(doc) !== null;
}

export class ScreenWakeLockController {
  private enabled = true;
  private activeIntent = false;
  private target: ScreenWakeLockTarget | null = null;
  private sentinel: ScreenWakeLockSentinelLike | null = null;
  private sentinelReleaseListener: (() => void) | null = null;
  private requestGeneration = 0;
  private pendingRequestGeneration: number | null = null;
  private warnedAboutRejection = false;

  constructor(private readonly onRequestRejected?: () => void) {}

  async setEnabled(enabled: boolean): Promise<void> {
    this.enabled = enabled;

    if (!enabled) {
      this.invalidatePendingRequest();
      await this.releaseCurrentSentinel();
      return;
    }

    await this.requestIfNeeded();
  }

  async start(target: ScreenWakeLockTarget | null): Promise<void> {
    this.activeIntent = true;

    if (this.target !== target) {
      this.detachTarget();
      this.invalidatePendingRequest();
      const releasePromise = this.releaseCurrentSentinel();
      this.target = target;
      this.target?.addVisibilityListener(this.handleVisibilityChange);
      await releasePromise;

      if (!this.activeIntent || this.target !== target) {
        return;
      }
    }

    await this.requestIfNeeded();
  }

  async stop(): Promise<void> {
    this.activeIntent = false;
    this.detachTarget();
    this.invalidatePendingRequest();
    await this.releaseCurrentSentinel();
  }

  async destroy(): Promise<void> {
    await this.stop();
  }

  private readonly handleVisibilityChange = (): void => {
    if (this.target?.visibilityState === "visible") {
      void this.requestIfNeeded();
      return;
    }

    this.invalidatePendingRequest();
    void this.releaseCurrentSentinel();
  };

  private async requestIfNeeded(): Promise<void> {
    const target = this.target;

    if (
      !this.enabled ||
      !this.activeIntent ||
      !target ||
      target.visibilityState !== "visible" ||
      (this.sentinel !== null && !this.sentinel.released) ||
      this.pendingRequestGeneration !== null
    ) {
      return;
    }

    const requestGeneration = ++this.requestGeneration;
    this.pendingRequestGeneration = requestGeneration;

    let sentinel: ScreenWakeLockSentinelLike;
    try {
      sentinel = await target.request();
    } catch {
      if (this.pendingRequestGeneration === requestGeneration) {
        this.pendingRequestGeneration = null;
      }
      if (
        this.requestGeneration === requestGeneration &&
        this.enabled &&
        this.activeIntent &&
        this.target === target &&
        !this.warnedAboutRejection
      ) {
        this.warnedAboutRejection = true;
        this.onRequestRejected?.();
      }
      return;
    }

    if (this.pendingRequestGeneration === requestGeneration) {
      this.pendingRequestGeneration = null;
    }

    if (
      this.requestGeneration !== requestGeneration ||
      !this.enabled ||
      !this.activeIntent ||
      this.target !== target ||
      target.visibilityState !== "visible"
    ) {
      await releaseSentinel(sentinel);
      return;
    }

    this.sentinel = sentinel;
    const releaseListener = () => {
      if (this.sentinel === sentinel) {
        this.sentinel = null;
        this.sentinelReleaseListener = null;
      }
      sentinel.removeEventListener("release", releaseListener);
    };
    this.sentinelReleaseListener = releaseListener;
    sentinel.addEventListener("release", releaseListener);
  }

  private detachTarget(): void {
    this.target?.removeVisibilityListener(this.handleVisibilityChange);
    this.target = null;
  }

  private invalidatePendingRequest(): void {
    this.requestGeneration++;
    this.pendingRequestGeneration = null;
  }

  private async releaseCurrentSentinel(): Promise<void> {
    const sentinel = this.sentinel;
    const releaseListener = this.sentinelReleaseListener;

    this.sentinel = null;
    this.sentinelReleaseListener = null;
    if (!sentinel) {
      return;
    }

    if (releaseListener) {
      sentinel.removeEventListener("release", releaseListener);
    }
    await releaseSentinel(sentinel);
  }
}

async function releaseSentinel(sentinel: ScreenWakeLockSentinelLike): Promise<void> {
  if (sentinel.released) {
    return;
  }

  try {
    await sentinel.release();
  } catch {
    // Wake lock release is best-effort and must never interrupt playback cleanup.
  }
}
