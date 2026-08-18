import { Task } from "./repository";
import tasksMap, { tasksConfig } from "./tasks";

const safeErrorNames = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError"]);
const safeErrorCodes = new Set(["P2002", "P2025", "ETIMEDOUT", "ECONNRESET", "ECONNREFUSED"]);

export function getTaskFailureClassification(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
    if (safeErrorCodes.has(error.code)) return error.code;
  }
  if (error instanceof Error && safeErrorNames.has(error.name)) return error.name;
  return "TaskExecutionError";
}

/**
 * TaskProcessor handles the processing of tasks from the queue.
 * This is separated from task creation to avoid importing all task handlers
 * when only creating tasks, which eliminates compilation overhead.
 */
export class TaskProcessor {
  async processQueue(): Promise<void> {
    const tasks = await Task.getNextBatch();
    console.info(`Processing ${tasks.length} tasks`);

    const tasksPromises = tasks.map(async (task) => {
      console.info(`Processing task ${task.id}, attempt:${task.attempts} maxAttempts:${task.maxAttempts}`);
      const taskHandlerGetter = tasksMap[task.type as keyof typeof tasksMap];
      if (!taskHandlerGetter) throw new Error(`Task handler not found for type ${task.type}`);
      const taskConfig = tasksConfig[task.type as keyof typeof tasksConfig];
      const taskHandler = await taskHandlerGetter();
      return taskHandler(task.payload, task.id)
        .then(async () => {
          await Task.succeed(task.id);
        })
        .catch(async (error) => {
          console.info(`Task ${task.id} failed; scheduling retry`);
          await Task.retry({
            taskId: task.id,
            lastError: getTaskFailureClassification(error),
            minRetryIntervalMins:
              taskConfig && "minRetryIntervalMins" in taskConfig ? taskConfig.minRetryIntervalMins : null,
          });
        });
    });
    const settled = await Promise.allSettled(tasksPromises);
    const failed = settled.filter((result) => result.status === "rejected");
    const succeded = settled.filter((result) => result.status === "fulfilled");
    console.info({ failedCount: failed.length, succeededCount: succeded.length });
  }
}
