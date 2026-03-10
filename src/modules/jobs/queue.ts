/**
 * In-memory job queue — replaces BullMQ + Redis.
 * Provides the same API surface used by the rest of the codebase:
 *   - addGenerationJob(jobId, payload)
 *   - generationQueue.getJob(jobId)
 *   - job.updateProgress(n)
 *   - job.log(msg)
 *   - job.data / job.returnvalue / job.getState()
 */

export interface InMemoryJob {
    id: string;
    data: any;
    returnvalue: any;
    progress: number;
    state: 'waiting' | 'active' | 'completed' | 'failed';
    logs: string[];
    failedReason?: string;

    updateProgress(value: number): Promise<void>;
    log(message: string): void;
    getState(): Promise<string>;
}

// In-memory store for all jobs
const jobStore = new Map<string, InMemoryJob>();

/**
 * Create a lightweight job object that mirrors the BullMQ Job interface
 */
function createJob(jobId: string, data: any): InMemoryJob {
    const job: InMemoryJob = {
        id: jobId,
        data,
        returnvalue: null,
        progress: 0,
        state: 'waiting',
        logs: [],

        async updateProgress(value: number) {
            this.progress = value;
        },

        log(message: string) {
            this.logs.push(message);
            console.log(`[Job ${jobId}] ${message}`);
        },

        async getState() {
            return this.state;
        }
    };

    return job;
}

/**
 * The in-memory queue — exposes getJob() for controllers
 */
export const generationQueue = {
    async getJob(jobId: string): Promise<InMemoryJob | undefined> {
        return jobStore.get(jobId);
    }
};

/**
 * Add and immediately process a generation job in the background
 */
export const addGenerationJob = async (jobId: string, payload: any) => {
    const job = createJob(jobId, payload);
    jobStore.set(jobId, job);

    // Import processor lazily to avoid circular deps
    const { processGenerationJob } = await import('./job.processor');

    // Fire-and-forget: run in background
    (async () => {
        try {
            job.state = 'active';
            console.log(`Processing job ${job.id}`);
            const result = await processGenerationJob(job);
            job.returnvalue = result;
            job.state = 'completed';
            console.log(`Job with id ${job.id} has been completed`);
        } catch (err: any) {
            job.state = 'failed';
            job.failedReason = err.message;
            console.error(`Job with id ${job.id} has failed with ${err.message}`);
        }

        // Auto-cleanup after 2 hours to prevent memory leaks
        setTimeout(() => {
            jobStore.delete(jobId);
        }, 2 * 60 * 60 * 1000);
    })();

    return job;
};
