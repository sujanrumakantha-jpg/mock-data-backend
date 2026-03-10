import { Queue } from 'bullmq';
import { redisClient } from '../../config/redis';

export const generationQueue = new Queue('data-generation', {
    connection: redisClient as any,
});

/**
 * Add a new job to the generation queue
 */
export const addGenerationJob = async (jobId: string, payload: any) => {
    return await generationQueue.add('generate', payload, {
        jobId, // Unique ID to prevent duplicates if needed
        removeOnComplete: { age: 3600 }, // Keep for 1 hour
        removeOnFail: { age: 24 * 3600 }, // Keep failed for 24 hours
    });
};
