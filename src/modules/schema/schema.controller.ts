import { Request, Response, NextFunction } from 'express';
import { SchemaService } from './schema.service';
import { SchemaParser } from './schema.parser';
import { DbService } from './db.service';

export const SchemaController = {
    /**
     * Upload a database schema (SQL, Prisma, etc.) and parse it
     */
    async uploadSchema(req: any, res: Response, next: NextFunction) {
        try {
            const { schemaContent, format, name } = req.body;
            const userId = req.user.id;

            if (!schemaContent || !format) {
                return res.status(400).json({ error: 'Schema content and format are required' });
            }

            const parsedSchema = await SchemaService.parseAndNormalize(schemaContent, format, userId, name);
            res.status(200).json({ success: true, data: parsedSchema });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Extracts schema from a live database
     */
    async extractFromDb(req: Request, res: Response, next: NextFunction) {
        try {
            const params = req.body;
            if (!params.type) {
                return res.status(400).json({ error: 'Database type (POSTGRES|MYSQL) is required' });
            }

            const schemaContent = await DbService.extractSchema(params);
            const format = params.type === 'POSTGRES' || params.type === 'POSTGRESQL' ? 'PostgreSQL' : 'MySQL';
            res.status(200).json({ success: true, data: { content: schemaContent, format } });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Extracts schema content and format from raw text using AI
     */
    async extractSchema(req: Request, res: Response, next: NextFunction) {
        try {
            const { text } = req.body;
            if (!text) {
                return res.status(400).json({ error: 'Text content is required for extraction' });
            }

            const result = await SchemaParser.extractSchemaFromText(text);
            res.status(200).json({ success: true, data: result });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get dynamic configuration questions based on parsed schema
     */
    async getConfigurationQuestions(req: Request, res: Response, next: NextFunction) {
        try {
            const schemaId = req.params.schemaId as string;
            const questions = await SchemaService.generateQuestions(schemaId);
            res.status(200).json({ success: true, data: questions });
        } catch (error) {
            next(error);
        }
    },

    /**
     * Get history of uploaded schemas for the authenticated user
     */
    async getHistory(req: any, res: Response, next: NextFunction) {
        try {
            const userId = req.user.id;
            const history = await SchemaService.getHistory(userId);
            res.status(200).json({ success: true, data: history });
        } catch (error) {
            next(error);
        }
    }
};
