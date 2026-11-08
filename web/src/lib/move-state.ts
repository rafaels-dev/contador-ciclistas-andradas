import type { FolderKind } from "./storage";

/**
 * State of a folder move (lib/move.ts), apart so the runner can wait for it
 * without importing the mover: a detection, a final video, a download or an
 * image rebuild started during a move waits for it to finish — otherwise it
 * would write into a folder that is being copied and then deleted.
 */
export type MoveState = {
  running: boolean;
  kind: FolderKind | null;
  total: number;
  copied: number;
  items: number;
  moved: number;
  failed: number;
  /** the item being moved now (its name) */
  current: string | null;
};

const g = globalThis as { __tcMove?: MoveState; __tcMoveWaiters?: (() => void)[] };
export const idleMove = (): MoveState => ({ running: false, kind: null, total: 0, copied: 0, items: 0, moved: 0, failed: 0, current: null });
export const moveStateRef = (): MoveState => (g.__tcMove ??= idleMove());
const waiters = () => (g.__tcMoveWaiters ??= []);

export function moving(): boolean {
  return moveStateRef().running;
}

/** Resolves when no move is running. */
export function moveFinished(): Promise<void> {
  if (!moving()) return Promise.resolve();
  return new Promise((resolve) => waiters().push(resolve));
}

/** Called by the mover when it stops. */
export function wakeMoveWaiters(): void {
  for (const w of waiters().splice(0)) w();
}
