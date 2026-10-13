import { AsyncLocalStorage } from "node:async_hooks";
export interface ExecutionContext {
  planId: string;
  taskId: string;
  attemptId: string;
}
export const executionContext = new AsyncLocalStorage<ExecutionContext>();
export const toolContext = new AsyncLocalStorage<{
  module: string;
  tool: string;
}>();
export class WorkspaceLocks {
  private tails = new Map<string, Promise<void>>();
  async run<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(id) ?? Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.tails.set(id, next);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.tails.get(id) === next) this.tails.delete(id);
    }
  }
}
