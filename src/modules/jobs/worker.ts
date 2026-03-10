import { Worker, Job } from 'bullmq';
import { redisClient } from '../../config/redis';
import { processGenerationJob } from './job.processor';

let worker: Worker;

export const initWorker = () => {
    worker = new Worker(
        'data-generation',
        async (job: Job) => {
            console.log(`Processing job ${job.id}`);
            return await processGenerationJob(job);
        },
        { connection: redisClient as any }
    );

    worker.on('completed', (job) => {
        console.log(`Job with id ${job.id} has been completed`);
    });

    worker.on('failed', (job, err) => {
        console.error(`Job with id ${job?.id} has failed with ${err.message}`);
    });

    console.log('BullMQ Worker Initialized...');
};

export const closeWorker = async () => {
    if (worker) {
        await worker.close();
    }
};
