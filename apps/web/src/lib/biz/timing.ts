/** Monotonic milliseconds for Gate B creation timing (unaffected by device clock changes). */
export const clockMs = (): number => performance.now();
