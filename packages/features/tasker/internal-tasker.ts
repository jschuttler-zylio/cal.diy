import logger from "@calcom/lib/logger";

import { Task } from "./repository";
import type { TaskTypes } from "./tasker";
import { type TaskerCreate, type Tasker } from "./tasker";

const defaultRetentionDays = 30;

export function getTaskRetentionDays(value = process.env.TASKER_RETENTION_DAYS): number {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 7 || days > 3650) return defaultRetentionDays;
  return days;
}

export function getTaskCleanupCutoff(now = new Date(), retentionDays = getTaskRetentionDays()): Date {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

/**
 * This is the default internal Tasker that uses the Task repository to create tasks.
 * It doesn't have any external dependencies and is suitable for most use cases.
 * To use a different Tasker, you can create a new class that implements the Tasker interface.
 * Then, you can use the TaskerFactory to select the new Tasker.
 */
export class InternalTasker implements Tasker {
  create: TaskerCreate = async (type, payload, options = {}): Promise<string> => {
    const payloadString = typeof payload === "string" ? payload : JSON.stringify(payload);
    return Task.create(type, payloadString, options);
  };

  async cleanup(): Promise<{ count: number; retentionDays: number }> {
    const retentionDays = getTaskRetentionDays();
    const result = await Task.cleanup(getTaskCleanupCutoff(undefined, retentionDays));
    logger.info(`Cleaned up ${result.count} terminal tasks older than ${retentionDays} days`);
    return { ...result, retentionDays };
  }

  async cancel(id: string): Promise<string> {
    const task = await Task.cancel(id);
    return task.id;
  }

  async cancelWithReference(referenceUid: string, type: TaskTypes): Promise<string | null> {
    const task = await Task.cancelWithReference(referenceUid, type);
    return task?.id ?? null;
  }
}
