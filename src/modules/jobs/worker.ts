/**
 * Worker initialization — no-op in the in-memory queue system.
 * Job processing happens inline in queue.ts when addGenerationJob is called.
 * This file is kept for backward compatibility with index.ts imports.
 */

export const initWorker = () => {
    console.log('In-memory job worker initialized (no Redis required).');
};

export const closeWorker = async () => {
    // No-op: nothing to close
};
