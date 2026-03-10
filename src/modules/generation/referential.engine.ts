export const ReferentialEngine = {
    /**
     * Group tables into levels for parallel processing based on dependencies
     */
    groupByLevel(tables: any[]) {
        const tableMap = new Map();
        const indegree = new Map();
        const adjList = new Map();

        // Build a set of known table names for reference validation
        const knownTables = new Set(tables.map(t => t.name));

        tables.forEach(t => {
            tableMap.set(t.name, t);
            indegree.set(t.name, 0);
        });

        tables.forEach(t => {
            if (t.foreignKeys && t.foreignKeys.length > 0) {
                t.foreignKeys.forEach((fk: any) => {
                    const refTable = fk.referenceTable;
                    
                    // CRITICAL FIX: Only count FK references to tables that exist in the schema
                    // Skip self-references and references to unknown/external tables
                    if (!knownTables.has(refTable) || refTable === t.name) {
                        return; // Skip this FK — referenced table is not in the schema
                    }

                    if (!adjList.has(refTable)) adjList.set(refTable, []);
                    adjList.get(refTable).push(t.name);
                    indegree.set(t.name, indegree.get(t.name) + 1);
                });
            }
        });

        const resultLevels: any[][] = [];
        const processed = new Set<string>();
        let currentQueue: string[] = [];
        indegree.forEach((val, key) => {
            if (val === 0) currentQueue.push(key);
        });

        while (currentQueue.length > 0) {
            const nextQueue: string[] = [];
            const currentLevel: any[] = [];

            currentQueue.forEach(name => {
                if (processed.has(name)) return;
                processed.add(name);
                currentLevel.push(tableMap.get(name));
                if (adjList.has(name)) {
                    adjList.get(name).forEach((neighbor: string) => {
                        indegree.set(neighbor, indegree.get(neighbor) - 1);
                        if (indegree.get(neighbor) === 0 && !processed.has(neighbor)) {
                            nextQueue.push(neighbor);
                        }
                    });
                }
            });

            if (currentLevel.length > 0) {
                resultLevels.push(currentLevel);
            }
            currentQueue = nextQueue;
        }

        // SAFETY NET: Catch any tables that were missed due to circular dependencies
        const remainingTables = tables.filter(t => !processed.has(t.name));
        if (remainingTables.length > 0) {
            console.warn(`[ReferentialEngine] ${remainingTables.length} tables had circular dependencies and were added to the last level: ${remainingTables.map(t => t.name).join(', ')}`);
            resultLevels.push(remainingTables);
        }

        console.log(`[ReferentialEngine] Grouped ${tables.length} tables into ${resultLevels.length} levels.`);
        return resultLevels;
    },

    buildForeignKeyContext(table: any, generatedDataStore: Record<string, any[]>) {
        if (!table.foreignKeys || table.foreignKeys.length === 0) return null;

        const contextContext: Record<string, any> = {};

        table.foreignKeys.forEach((fk: any) => {
            const referenceTable = fk.referenceTable;
            const dataStoreRef = generatedDataStore[referenceTable];
            if (dataStoreRef && dataStoreRef.length > 0) {
                // Collect a random sample of existing IDs to give to OpenAI as valid ranges
                const validIds = dataStoreRef.slice(0, 50).map(row => row[fk.referenceColumn]);
                contextContext[fk.column] = {
                    referenceTable,
                    referenceColumn: fk.referenceColumn,
                    validSamples: validIds
                };
            }
        });

        return contextContext;
    }
};
