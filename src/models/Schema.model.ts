import mongoose, { Schema, Document } from 'mongoose';

export interface ISchema extends Document {
    userId: mongoose.Types.ObjectId;
    name: string;
    originalFormat: string;
    originalContent: string;
    normalizedSchema: any; // JSON representation
    status: 'PENDING' | 'PARSED' | 'FAILED';
    createdAt: Date;
}

const SchemaDefinition = new Schema({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
    },
    name: {
        type: String,
        default: 'Untitled Project',
    },
    originalFormat: {
        type: String,
        enum: ['SQL', 'PostgreSQL', 'MySQL', 'Prisma', 'Sequelize', 'MongoDB', 'GraphQL', 'TypeScript', 'DirectConnection'],
        required: true,
    },
    originalContent: {
        type: String,
        required: true,
    },
    normalizedSchema: {
        type: Schema.Types.Mixed,
        default: null,
    },
    status: {
        type: String,
        enum: ['PENDING', 'PARSED', 'FAILED'],
        default: 'PENDING',
    },
    createdAt: { type: Date, default: Date.now }
});

export const SchemaModel = mongoose.model<ISchema>('Schema', SchemaDefinition);
