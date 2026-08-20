const failedTaskStatuses = new Set(['failed', 'cancelled', 'banned', 'expired', 'unknown']);
const ongoingTaskStatuses = new Set(['queued', 'running']);

const noop = () => {};

export class ModelGenerationQueue {
  constructor({
    createTask,
    getTask,
    maxConcurrent = 2,
    pollInterval = 2000,
    maxPollInterval = 10_000,
    setTimer = (callback, delay) => globalThis.setTimeout(callback, delay),
    clearTimer = (timer) => globalThis.clearTimeout(timer),
    onTaskPending = noop,
    onTaskProgress = noop,
    onTaskSuccess = noop,
    onTaskFailure = noop,
    onCreateRetry = noop,
    onQueueChange = noop,
  }) {
    this.createTask = createTask;
    this.getTask = getTask;
    this.maxConcurrent = maxConcurrent;
    this.pollInterval = pollInterval;
    this.maxPollInterval = maxPollInterval;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.onTaskPending = onTaskPending;
    this.onTaskProgress = onTaskProgress;
    this.onTaskSuccess = onTaskSuccess;
    this.onTaskFailure = onTaskFailure;
    this.onCreateRetry = onCreateRetry;
    this.onQueueChange = onQueueChange;
    this.waitingJobs = [];
    this.activeEntries = new Set();
    this.stopped = false;
  }

  enqueue(job) {
    if (this.stopped) {
      return;
    }
    this.waitingJobs.push(job);
    this.emitQueueChange();
    this.pump();
  }

  restore(tasks) {
    const restoredTaskIds = new Set(
      [...this.activeEntries]
        .map((entry) => entry.task?.taskId)
        .filter(Boolean),
    );

    tasks.forEach((task, index) => {
      if (!task?.taskId || restoredTaskIds.has(task.taskId)) {
        return;
      }

      restoredTaskIds.add(task.taskId);
      const entry = this.createEntry(undefined, task);
      this.activeEntries.add(entry);
      this.onTaskPending(task, { restored: true });
      this.schedule(entry, () => this.poll(entry), index * 100);
    });
    this.emitQueueChange();
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
    this.emitQueueChange();
  }

  createEntry(job, task) {
    return {
      job,
      task,
      timer: undefined,
      createFailures: 0,
      pollFailures: 0,
    };
  }

  pump() {
    if (this.stopped) {
      return;
    }

    while (this.activeEntries.size < this.maxConcurrent && this.waitingJobs.length) {
      const entry = this.createEntry(this.waitingJobs.shift());
      this.activeEntries.add(entry);
      void this.start(entry);
    }
    this.emitQueueChange();
  }

  async start(entry) {
    try {
      const created = await this.createTask(entry.job.image, entry.job.name);
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }
      entry.task = {
        taskId: created.taskId,
        name: entry.job.name?.trim() || '新しいモデル',
        progress: created.progress || 0,
      };
      entry.job = undefined;
      entry.createFailures = 0;
      this.onTaskPending(entry.task, { restored: false });
      this.schedule(entry, () => this.poll(entry), 0);
    } catch (error) {
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }
      if (error.status === 429 && !this.stopped) {
        entry.createFailures += 1;
        const retryDelay = error.retryAfterMs
          ?? Math.min(this.pollInterval * (2 ** entry.createFailures), this.maxPollInterval);
        this.onCreateRetry(error, retryDelay);
        this.schedule(entry, () => this.start(entry), retryDelay);
        return;
      }

      this.finish(entry, () => this.onTaskFailure(undefined, error));
    }
  }

  async poll(entry) {
    if (!this.activeEntries.has(entry) || !entry.task) {
      return;
    }

    try {
      const currentTask = await this.getTask(entry.task.taskId, entry.task.name);
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }
      entry.pollFailures = 0;

      if (currentTask.status === 'success') {
        this.finish(entry, () => this.onTaskSuccess(entry.task, currentTask.model));
        return;
      }

      if (failedTaskStatuses.has(currentTask.status)) {
        const error = new Error(currentTask.error || 'モデル生成に失敗しました。');
        this.finish(entry, () => this.onTaskFailure(entry.task, error));
        return;
      }

      if (!ongoingTaskStatuses.has(currentTask.status)) {
        const error = new Error('モデル生成の状態を確認できませんでした。');
        this.finish(entry, () => this.onTaskFailure(entry.task, error));
        return;
      }

      entry.task = {
        ...entry.task,
        progress: currentTask.progress || 0,
      };
      this.onTaskProgress(entry.task);
      this.schedule(entry, () => this.poll(entry), this.pollInterval);
    } catch (error) {
      if (this.stopped || !this.activeEntries.has(entry)) {
        return;
      }
      entry.pollFailures += 1;
      const retryDelay = Math.min(
        this.pollInterval * (2 ** Math.min(entry.pollFailures, 3)),
        this.maxPollInterval,
      );
      this.schedule(entry, () => this.poll(entry), retryDelay);
    }
  }

  finish(entry, callback) {
    if (!this.activeEntries.delete(entry)) {
      return;
    }
    if (entry.timer !== undefined) {
      this.clearTimer(entry.timer);
      entry.timer = undefined;
    }
    try {
      callback();
    } finally {
      this.emitQueueChange();
      this.pump();
    }
  }

  schedule(entry, callback, delay) {
    if (this.stopped || !this.activeEntries.has(entry)) {
      return;
    }
    if (entry.timer !== undefined) {
      this.clearTimer(entry.timer);
    }
    entry.timer = this.setTimer(() => {
      entry.timer = undefined;
      void callback();
    }, delay);
  }

  emitQueueChange() {
    this.onQueueChange(this.getState());
  }
}
