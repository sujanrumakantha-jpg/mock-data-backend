import { InMemoryJob } from '../jobs/queue';
import { SchemaModel } from '../../models/Schema.model';
import { ReferentialEngine } from './referential.engine';
import { BlueprintGenerator } from './blueprint.generator';
import { LocalEngine } from './local.engine';

/**
 * Two-Phase Generation Pipeline:
 * Phase 1 (AI): Generate blueprints in PARALLEL within each dependency level
 * Phase 2 (Local): Execute blueprints locally using faker.js (zero API calls)
 * 
 * Architecture:
 * - Tables are grouped by referential dependency levels
 * - Within each level, blueprints are generated in parallel (up to CONCURRENCY_LIMIT)
 * - Failed tables are skipped with warnings, not crashes
 * - FK integrity is preserved by processing levels in order
 */

const CONCURRENCY_LIMIT = 20; // Max parallel AI calls per batch (1 agent per ~3 tables for 57-table schemas)

/**
 * Process an array of items with concurrency control
 */
async function parallelWithLimit<T, R>(
    items: T[],
    fn: (item: T) => Promise<R>,
    limit: number
): Promise<{ results: R[]; errors: { item: T; error: Error }[] }> {
    const results: R[] = [];
    const errors: { item: T; error: Error }[] = [];
    
    for (let i = 0; i < items.length; i += limit) {
        const batch = items.slice(i, i + limit);
        const settled = await Promise.allSettled(batch.map(fn));
        
        settled.forEach((result, idx) => {
            if (result.status === 'fulfilled') {
                results.push(result.value);
            } else {
                errors.push({ item: batch[idx], error: result.reason });
            }
        });
    }
    
    return { results, errors };
}

export const generateDataBatch = async (schemaId: string, config: any, job: InMemoryJob) => {
    const schemaDoc = await SchemaModel.findById(schemaId);
    if (!schemaDoc) throw new Error('Schema not found');

    const parsedSchema = schemaDoc.normalizedSchema;

    // Group tables by referential dependency levels
    const tableLevels = ReferentialEngine.groupByLevel(parsedSchema.tables);

    const totalTables = parsedSchema.tables.length;
    const rowsPerTable = config.rows || 10;
    const totalRowsExpected = totalTables * rowsPerTable;

    const generatedDataStore: Record<string, any[]> = {};
    const blueprintStore: Record<string, any[]> = {};
    const completedTableNames: string[] = [];
    const failedTables: string[] = [];

    job.log(`🚀 Blueprint Engine started: ${totalTables} tables × ${rowsPerTable.toLocaleString()} rows = ${totalRowsExpected.toLocaleString()} total records`);
    job.log(`⚡ Parallel mode: up to ${CONCURRENCY_LIMIT} concurrent AI agents per level (dynamic scaling)`);

    // ═══════════════════════════════════════════════
    // PHASE 1: Generate blueprints (PARALLEL within each level)
    // ═══════════════════════════════════════════════
    job.log(`📐 Phase 1: Generating AI blueprints (${tableLevels.length} dependency levels)...`);
    await job.updateProgress(0);

    let blueprintsGenerated = 0;
    for (let l = 0; l < tableLevels.length; l++) {
        const currentLevel = tableLevels[l];
        job.log(`📐 Level ${l}: Processing ${currentLevel.length} tables in parallel...`);

        const { results, errors } = await parallelWithLimit(
            currentLevel,
            async (table: any) => {
                job.log(`[${table.name}] 🤖 AI agent spawned...`);
                const blueprint = await BlueprintGenerator.generateBlueprint(table, config, completedTableNames);
                return { name: table.name, blueprint };
            },
            CONCURRENCY_LIMIT
        );

        // Process successful results
        for (const { name, blueprint } of results) {
            blueprintStore[name] = blueprint;
            completedTableNames.push(name);
            blueprintsGenerated++;
            job.log(`[${name}] ✓ Blueprint received (${blueprint.length} column rules)`);
        }

        // Use deterministic fallback for any AI failures — NEVER skip a table
        for (const { item, error } of errors) {
            const failedTable = item as any;
            job.log(`[${failedTable.name}] ⚠️ AI failed: ${error.message} → using deterministic fallback`);
            try {
                const fallbackBlueprint = BlueprintGenerator._generateDeterministicBlueprint(failedTable);
                blueprintStore[failedTable.name] = fallbackBlueprint;
                completedTableNames.push(failedTable.name);
                blueprintsGenerated++;
                job.log(`[${failedTable.name}] ✓ Deterministic blueprint generated (${fallbackBlueprint.length} column rules)`);
            } catch (fallbackErr: any) {
                failedTables.push(failedTable.name);
                job.log(`[${failedTable.name}] ❌ Even deterministic fallback failed: ${fallbackErr.message}`);
            }
        }

        const blueprintProgress = Math.round((blueprintsGenerated / totalTables) * 30);
        await job.updateProgress(blueprintProgress);
    }

    job.log(`📐 Phase 1 complete: ${blueprintsGenerated}/${totalTables} blueprints generated.${failedTables.length > 0 ? ` Skipped: ${failedTables.join(', ')}` : ''}`);
    await job.updateProgress(30);

    // ═══════════════════════════════════════════════
    // PHASE 2: Local data generation (zero API calls)
    // ═══════════════════════════════════════════════
    job.log(`⚡ Phase 2: Local data generation started...`);

    let tablesGenerated = 0;
    for (let l = 0; l < tableLevels.length; l++) {
        const currentLevel = tableLevels[l];

        for (const table of currentLevel) {
            try {
                const blueprint = blueprintStore[table.name];
                if (!blueprint) {
                    job.log(`[${table.name}] ⏭️ Skipping (no blueprint)`);
                    continue;
                }

                const startTime = Date.now();
                const rows = LocalEngine.generateRows(blueprint, rowsPerTable, generatedDataStore);
                const elapsed = Date.now() - startTime;

                generatedDataStore[table.name] = rows;
                tablesGenerated++;

                const localProgress = 30 + Math.round((tablesGenerated / totalTables) * 69);
                await job.updateProgress(localProgress);

                job.log(`[${table.name}] ⚡ Generated ${rows.length.toLocaleString()} rows in ${elapsed}ms`);
            } catch (err: any) {
                job.log(`[${table.name}] ⚠️ Local generation SKIPPED: ${err.message}`);
                failedTables.push(table.name);
            }
        }
    }

    await job.updateProgress(100);
    const totalGenerated = Object.values(generatedDataStore).reduce((sum, arr) => sum + arr.length, 0);
    job.log(`✅ Generation complete. ${tablesGenerated}/${totalTables} tables, ${totalGenerated.toLocaleString()} total records.`);
    if (failedTables.length > 0) {
        job.log(`⚠️ Skipped tables: ${[...new Set(failedTables)].join(', ')}`);
    }

    return generatedDataStore;
};
