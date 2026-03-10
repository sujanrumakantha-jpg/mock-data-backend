import { SchemaModel } from '../../models/Schema.model';
import { SchemaParser } from './schema.parser';
// import { v4 as uuidv4 } from 'uuid'; 

export const SchemaService = {
    /**
     * Parse the schema content using OpenAI and store in MongoDB
     */
    async parseAndNormalize(content: string, format: string, userId: string, name?: string) {
        // 1. Create pending record
        const schemaDoc = await SchemaModel.create({
            userId,
            name: name || `Project ${new Date().toLocaleDateString()}`,
            originalFormat: format,
            originalContent: content,
            status: 'PENDING'
        });

        try {
            // 2. Parse using AI
            const normalizedJson = await SchemaParser.parseWithAI(content, format);

            // 3. Update document
            schemaDoc.normalizedSchema = normalizedJson;
            schemaDoc.status = 'PARSED';
            await schemaDoc.save();

            return schemaDoc;
        } catch (error) {
            schemaDoc.status = 'FAILED';
            await schemaDoc.save();
            throw new Error(`Failed to parse schema: ${(error as Error).message}`);
        }
    },

    /**
     * Generate configuration questions dynamically based on the parsed schema
     */
    async generateQuestions(schemaId: string) {
        const schemaDoc = await SchemaModel.findById(schemaId);
        if (!schemaDoc || schemaDoc.status !== 'PARSED') {
            throw new Error('Schema not found or not fully parsed yet.');
        }

        const { normalizedSchema } = schemaDoc;
        // We could ask AI to generate these, or use a structural builder
        const questions = [
            {
                id: 'rowsPerTable',
                label: 'Average number of rows to generate per table?',
                type: 'number',
                default: 100
            },
            {
                id: 'industryContext',
                label: 'What is the industry or domain context?',
                type: 'select',
                options: ['Healthcare', 'E-commerce', 'Fintech', 'Social Media', 'Generic'],
                default: 'Generic'
            },
            {
                id: 'strictReferential',
                label: 'Enforce strict referential integrity?',
                type: 'boolean',
                default: true
            },
            {
                id: 'edgeCases',
                label: 'Include edge cases (nulls, boundary values)?',
                type: 'boolean',
                default: false
            },
            {
                id: 'realismLevel',
                label: 'Data realism level',
                type: 'select',
                options: ['Low', 'Medium', 'High'],
                default: 'Medium'
            }
        ];

        return questions;
    },

    /**
     * Get history of uploaded schemas for a user
     */
    async getHistory(userId: string) {
        return SchemaModel.find({ userId }).sort({ createdAt: -1 });
    }
};
