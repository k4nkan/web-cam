const defaultStorageKey = 'web-cam.pending-model-tasks';

function isPendingTask(task) {
  return task && typeof task.taskId === 'string' && task.taskId.length > 0;
}

export function createPendingTaskStore({
  storage = window.localStorage,
  storageKey = defaultStorageKey,
  logger = console,
} = {}) {
  function read() {
    try {
      const tasks = JSON.parse(storage.getItem(storageKey) || '[]');
      if (!Array.isArray(tasks)) {
        return [];
      }
      return tasks.filter(isPendingTask);
    } catch (error) {
      logger.error(error);
      return [];
    }
  }

  function write(tasks) {
    try {
      storage.setItem(storageKey, JSON.stringify(tasks));
    } catch (error) {
      logger.error(error);
    }
  }

  return {
    read,

    upsert(task) {
      write([...read().filter((item) => item.taskId !== task.taskId), task]);
    },

    remove(taskId) {
      write(read().filter((task) => task.taskId !== taskId));
    },
  };
}
