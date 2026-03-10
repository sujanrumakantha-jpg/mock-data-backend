import { faker } from '@faker-js/faker';
import { ColumnBlueprint } from './blueprint.generator';

/**
 * LocalEngine: Takes a blueprint + row count and generates all rows locally.
 * Zero API calls. Blazing fast.
 */
export const LocalEngine = {
    generateRows(
        blueprint: ColumnBlueprint[],
        rowCount: number,
        generatedDataStore: Record<string, any[]>
    ): any[] {
        const rows: any[] = [];

        // Pre-compute FK pools for fast random access
        const fkPools: Record<string, any[]> = {};
        for (const col of blueprint) {
            if (col.strategy === 'foreignKey' && col.referenceTable && col.referenceColumn) {
                const parentData = generatedDataStore[col.referenceTable];
                if (parentData && parentData.length > 0) {
                    fkPools[col.name] = parentData.map(row => row[col.referenceColumn!]);
                } else {
                    fkPools[col.name] = [1]; // Fallback
                }
            }
        }

        // Pre-compute autoIncrement counters
        const autoIncrementCounters: Record<string, number> = {};
        for (const col of blueprint) {
            if (col.strategy === 'autoIncrement') {
                autoIncrementCounters[col.name] = col.startAt || 1;
            }
        }

        for (let i = 0; i < rowCount; i++) {
            const row: Record<string, any> = {};

            for (const col of blueprint) {
                row[col.name] = this._generateValue(col, i, autoIncrementCounters, fkPools);
            }

            rows.push(row);
        }

        return rows;
    },

    _generateValue(
        col: ColumnBlueprint,
        _rowIndex: number,
        autoIncrementCounters: Record<string, number>,
        fkPools: Record<string, any[]>
    ): any {
        try {
            switch (col.strategy) {
                case 'autoIncrement': {
                    const val = autoIncrementCounters[col.name];
                    autoIncrementCounters[col.name] = val + 1;
                    return val;
                }

                case 'faker': {
                    return this._callFakerMethod(col.method || 'lorem.word');
                }

                case 'template': {
                    return faker.helpers.fake(col.template || '{{lorem.word}}');
                }

                case 'enum': {
                    if (!col.values || col.values.length === 0) return null;
                    if (col.weights && col.weights.length === col.values.length) {
                        return faker.helpers.weightedArrayElement(
                            col.values.map((v, i) => ({ value: v, weight: col.weights![i] }))
                        );
                    }
                    return faker.helpers.arrayElement(col.values);
                }

                case 'dateRange': {
                    const from = col.from ? new Date(col.from) : new Date('2023-01-01');
                    const to = col.to ? new Date(col.to) : new Date();
                    return faker.date.between({ from, to }).toISOString().split('T')[0];
                }

                case 'numberRange': {
                    const min = col.min ?? 0;
                    const max = col.max ?? 10000;
                    const precision = col.precision ?? 0;
                    if (precision > 0) {
                        return parseFloat(faker.number.float({ min, max, fractionDigits: precision }).toFixed(precision));
                    }
                    return faker.number.int({ min, max });
                }

                case 'uuid': {
                    return faker.string.uuid();
                }

                case 'boolean': {
                    const probability = col.probability ?? 0.5;
                    return Math.random() < probability;
                }

                case 'constant': {
                    return col.value ?? null;
                }

                case 'foreignKey': {
                    const pool = fkPools[col.name];
                    if (pool && pool.length > 0) {
                        return pool[Math.floor(Math.random() * pool.length)];
                    }
                    return 1; // Fallback
                }

                default: {
                    return faker.lorem.word();
                }
            }
        } catch (err: any) {
            console.warn(`[LocalEngine] Error generating value for column "${col.name}" (strategy: ${col.strategy}): ${err.message}. Using fallback.`);
            return this._fallbackValue(col);
        }
    },

    /**
     * Dynamically call a faker method by dot-notation path, e.g. "person.firstName"
     * Includes fallback mapping for deprecated/invalid paths.
     */
    _callFakerMethod(methodPath: string): any {
        // Map deprecated/invalid faker paths to valid v8+ alternatives
        const FAKER_PATH_MAP: Record<string, string | (() => any)> = {
            'datatype.json': () => JSON.stringify({ key: faker.lorem.word(), value: faker.lorem.word() }),
            'datatype.string': 'string.alpha',
            'datatype.number': 'number.int',
            'datatype.float': 'number.float',
            'datatype.boolean': 'datatype.boolean',
            'datatype.uuid': 'string.uuid',
            'datatype.datetime': 'date.past',
            'datatype.array': () => [faker.lorem.word(), faker.lorem.word()],
            'datatype.bigInt': () => faker.number.int({ min: 100000, max: 999999999 }),
            'name.firstName': 'person.firstName',
            'name.lastName': 'person.lastName',
            'name.fullName': 'person.fullName',
            'name.findName': 'person.fullName',
            'name.jobTitle': 'person.jobTitle',
            'name.prefix': 'person.prefix',
            'name.suffix': 'person.suffix',
            'address.city': 'location.city',
            'address.country': 'location.country',
            'address.streetAddress': 'location.streetAddress',
            'address.zipCode': 'location.zipCode',
            'address.state': 'location.state',
            'address.countryCode': 'location.countryCode',
            'address.latitude': 'location.latitude',
            'address.longitude': 'location.longitude',
            'random.uuid': 'string.uuid',
            'random.word': 'lorem.word',
            'random.words': 'lorem.words',
            'random.alphaNumeric': 'string.alphanumeric',
            'random.number': 'number.int',
            'random.float': 'number.float',
            'random.boolean': 'datatype.boolean',
            'random.image': 'image.url',
            'image.imageUrl': 'image.url',
            'finance.iban': 'finance.iban',
            'finance.bic': 'finance.bic',
        };

        // Check if the path needs mapping
        const mapped = FAKER_PATH_MAP[methodPath];
        if (typeof mapped === 'function') {
            return mapped();
        }
        const resolvedPath = typeof mapped === 'string' ? mapped : methodPath;

        const parts = resolvedPath.split('.');
        let current: any = faker;
        for (const part of parts) {
            if (current[part] === undefined) {
                console.warn(`[LocalEngine] Invalid faker path: "${resolvedPath}" (original: "${methodPath}"). Using fallback.`);
                return faker.lorem.word();
            }
            current = current[part];
        }
        if (typeof current === 'function') {
            return current();
        }
        return current;
    },

    /**
     * Produce a safe fallback value based on strategy type.
     */
    _fallbackValue(col: ColumnBlueprint): any {
        switch (col.strategy) {
            case 'autoIncrement': return 1;
            case 'faker': return faker.lorem.word();
            case 'template': return faker.internet.email();
            case 'enum': return col.values?.[0] ?? 'unknown';
            case 'dateRange': return new Date().toISOString().split('T')[0];
            case 'numberRange': return col.min ?? 0;
            case 'uuid': return faker.string.uuid();
            case 'boolean': return false;
            case 'constant': return col.value ?? null;
            case 'foreignKey': return 1;
            default: return null;
        }
    }
};
