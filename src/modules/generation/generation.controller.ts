import { Request, Response, NextFunction } from 'express';
import { addGenerationJob } from '../jobs/queue';
import { SchemaModel } from '../../models/Schema.model';
import { generationQueue } from '../jobs/queue';

export const GenerationController = {
    /**
     * Start generation background job
     */
    async startGeneration(req: Request, res: Response, next: NextFunction) {
        try {
            const { schemaId, config } = req.body;

            if (!schemaId || !config) {
                return res.status(400).json({ error: 'schemaId and config are required' });
            }

            // Verify schema exists
            const schema = await SchemaModel.findById(schemaId);
            if (!schema || schema.status !== 'PARSED') {
                return res.status(400).json({ error: 'Schema not found or not parsed successfully.' });
            }

            const jobId = `job_${schemaId}_${Date.now()}`;

            // Dispatch to BullMQ
            await addGenerationJob(jobId, { schemaId, config });

            res.status(202).json({
                success: true,
                message: 'Generation job started.',
                jobId
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get job status
     */
    async getJobStatus(req: Request, res: Response, next: NextFunction) {
        try {
            const { jobId } = req.params;

            const job = await generationQueue.getJob(jobId as string);

            if (!job) {
                // If not in queue, it might be completed and removed, or never existed
                return res.status(200).json({
                    jobId,
                    status: 'completed',
                    progress: 100
                });
            }

            const state = await job.getState(); // completed, failed, active, waiting, etc
            const progress = job.progress || 0;

            // Fetch schema to get table count
            const schema = await SchemaModel.findById(job.data.schemaId);
            const totalTables = schema?.normalizedSchema?.tables?.length || 0;
            const rowsPerTable = job.data.config?.rows || 10;

            res.status(200).json({
                jobId,
                status: state === 'active' ? 'in-progress' : (state === 'completed' ? 'completed' : (state === 'failed' ? 'failed' : 'pending')),
                progress,
                totalTables,
                rowsPerTable
            });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get job result
     */
    async getJobResult(req: Request, res: Response, next: NextFunction) {
        try {
            const { jobId } = req.params;
            const job = await generationQueue.getJob(jobId as string);

            if (!job) {
                return res.status(404).json({ error: 'Job not found' });
            }

            const state = await job.getState();
            if (state !== 'completed') {
                return res.status(400).json({ error: 'Job is not completed yet', status: state });
            }

            // Fetch associated schema to get the format
            const schema = await SchemaModel.findById(job.data.schemaId);

            res.status(200).json({
                jobId,
                format: schema?.originalFormat || 'SQL',
                data: job.returnvalue
            });
        } catch (error) {
            next(error);
        }
    }
};
