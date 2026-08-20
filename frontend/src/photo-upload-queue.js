const noop = () => {};

function isRetryable(error) {
  return error.status === undefined
    || error.status === 408
    || error.status === 429
    || error.status >= 500;
}

export class PhotoUploadQueue {
  constructor({
    upload,
    maxConcurrent = 2,
    maxAttempts = 4,
    retryDelay = 1000,
    maxRetryDelay = 10_000,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    onSuccess = noop,
    onFailure = noop,
    onRetry = noop,
    onQueueChange = noop,
  }) {
    this.upload = upload;
    this.maxConcurrent = maxConcurrent;
    this.maxAttempts = maxAttempts;
    this.retryDelay = retryDelay;
    this.maxRetryDelay = maxRetryDelay;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onSuccess = onSuccess;
    this.onFailure = onFailure;
    this.onRetry = onRetry;
    this.onQueueChange = onQueueChange;
    this.waitingJobs = [];
    this.activeEntries = new Set();
    this.knownIds = new Set();
    this.stopped = false;
  }

  enqueue(job) {
    if (this.stopped || !job?.id || this.knownIds.has(job.id)) {
      return false;
    }

    this.knownIds.add(job.id);
    this.waitingJobs.push(job);
    this.emitQueueChange();
    this.pump();
    return true;
  }

  getState() {
    return {
      activeCount: this.activeEntries.size,
      queuedCount: this.waitingJobs.length,
    };
  }

  stop() {
    this.stopped = true;
    this.waitingJobs = [];
    this.activeEntries.forEach((entry) => {
      if (entry.timer !== undefined) {
        this.clearTimer(entry.timer);
      }
    });
    this.activeEntries.clear();
    this.knownIds.clear();
    this.emitQueueChange();
  }

  pump() {
    if (this.stopped) {
      return;
    }

    while (this.activeEntries.size < this.maxConcurrent && this.waitingJobs.length) {
      const entry = {
        job: this.waitingJobs.shift(),
        attempts: 0,
        timer: undefined,
      };
      this.activeEntries.add(entry);
      void this.run(entry);
    }
    this.emitQueueChange();
  }

  async run(entry) {
    entry.attempts += 1;

    try {
      const photo = await this.upload(entry.job.image, entry.job.id);
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }
      this.finish(entry, () => this.onSuccess(entry.job, photo));
    } catch (error) {
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }

      if (entry.attempts < this.maxAttempts && isRetryable(error)) {
        const delay = error.retryAfterMs ?? Math.min(
          this.retryDelay * (2 ** (entry.attempts - 1)),
          this.maxRetryDelay,
        );
        this.onRetry(entry.job, error, delay, entry.attempts);
        entry.timer = this.setTimer(() => {
          entry.timer = undefined;
          void this.run(entry);
        }, delay);
        return;
      }

      this.finish(entry, () => this.onFailure(entry.job, error));
    }
  }

  finish(entry, callback) {
    if (!this.activeEntries.delete(entry)) {
      return;
    }
    this.knownIds.delete(entry.job.id);
    try {
      callback();
    } finally {
      this.emitQueueChange();
      this.pump();
    }
  }

  emitQueueChange() {
    this.onQueueChange(this.getState());
  }
}
