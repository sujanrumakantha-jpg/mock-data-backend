import { InMemoryJob } from './queue';
import { generateDataBatch } from '../generation/generation.service';

export const processGenerationJob = async (job: InMemoryJob) => {
    try {
        const { schemaId, config } = job.data;

        // Call the generation service
        const generatedDataStore = await generateDataBatch(schemaId, config, job);

        // Make it 100% when done
        await job.updateProgress(100);

        // Return the data store directly so it's stored as job.returnvalue
        return generatedDataStore;
    } catch (err: any) {
        throw new Error(`Generation failed: ${err.message}`);
    }
};
