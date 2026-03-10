import { openai } from '../../config/openai';

/**
 * BlueprintGenerator: Uses ONE OpenAI call per table to produce a data blueprint.
 * Has 3 fallback layers:
 *   1. Full AI prompt with detailed instructions
 *   2. Simplified AI prompt (retry)
 *   3. Deterministic blueprint from column metadata (ZERO AI, guaranteed)
 */
export const BlueprintGenerator = {
    async generateBlueprint(table: any, config: any, parentTableNames: string[]): Promise<ColumnBlueprint[]> {
        const fkInfo = table.foreignKeys?.length > 0
            ? `\nForeign Keys:\n${table.foreignKeys.map((fk: any) => `  - Column "${fk.column}" references "${fk.referenceTable}"."${fk.referenceColumn}"`).join('\n')}`
            : '';

        const prompt = `You are a data-generation architect. Given a database table schema, produce a JSON object containing a "blueprint" array that describes HOW to generate realistic synthetic data for each column using faker.js strategies.

Table: "${table.name}"
Industry context: ${config.industry || 'Generic'}
Realism level: ${config.realism || 'Medium'}

Columns:
${JSON.stringify(table.columns, null, 2)}
${fkInfo}

Return a JSON object: {"blueprint": [...]} where each element describes ONE column with these fields:
- "name": column name (must match schema exactly)
- "strategy": one of: "autoIncrement", "faker", "template", "enum", "dateRange", "numberRange", "uuid", "boolean", "constant", "foreignKey"
- Additional fields based on strategy:
  - autoIncrement: { "startAt": 1 }
  - faker: { "method": "person.firstName" } — ONLY use these valid @faker-js/faker method paths:
    person.firstName, person.lastName, person.fullName, person.gender, person.jobTitle, person.jobArea,
    internet.email, internet.url, internet.userName, internet.password, internet.domainName,
    phone.number, company.name, company.buzzPhrase, company.catchPhrase,
    location.city, location.country, location.countryCode, location.streetAddress, location.zipCode, location.state,
    commerce.productName, commerce.price, commerce.department,
    finance.accountNumber, finance.currencyCode, finance.amount, finance.transactionType,
    lorem.sentence, lorem.paragraph, lorem.words, lorem.word,
    string.uuid, string.alphanumeric, string.alpha, string.nanoid,
    number.int, number.float,
    date.past, date.recent, date.future, date.birthdate,
    system.fileName, system.filePath, system.mimeType,
    color.human, hacker.phrase, music.genre, vehicle.vehicle, animal.dog
  - DO NOT use "datatype.json", "datatype.string", "datatype.number" — these are INVALID in @faker-js/faker v8+
  - template: { "template": "{{person.firstName}}.{{person.lastName}}@{{internet.domainName}}" }
  - enum: { "values": ["active","inactive"], "weights": [70,30] }
  - dateRange: { "from": "2023-01-01", "to": "2025-12-31" }
  - numberRange: { "min": 1, "max": 10000, "precision": 2 }
  - uuid: {} (no extra fields)
  - boolean: { "probability": 0.5 }
  - constant: { "value": "some_fixed_value" }
  - foreignKey: { "referenceTable": "users", "referenceColumn": "id" }

RULES:
1. For primary key / id columns: use "autoIncrement" for integer types, "uuid" for string/UUID types.
2. For foreign key columns: ALWAYS use strategy "foreignKey" with the correct referenceTable and referenceColumn.
3. For email columns: use "template" strategy.
4. For JSON/JSONB columns: use "constant" with a realistic sample JSON object as the value (e.g. {"key": "value"}).
5. Use "enum" with weighted distributions for status/type/category columns.
6. For date columns: use "dateRange" with sensible ranges.
7. For numeric/price/amount columns: use "numberRange" with realistic min/max/precision.

Parent tables already generated: [${parentTableNames.join(', ')}]`;

        // Layer 1: Full AI prompt
        try {
            return await this._callAI(prompt);
        } catch (err: any) {
            console.warn(`[BlueprintGenerator] AI attempt 1 failed for ${table.name}: ${err.message}`);
        }

        // Layer 2: Simplified AI prompt (retry)
        try {
            const simplePrompt = `Generate a JSON object {"blueprint": [...]} for table "${table.name}" with columns: ${table.columns.map((c: any) => `${c.name}(${c.type})`).join(', ')}. Each element: {"name":"col","strategy":"faker|uuid|autoIncrement|enum|dateRange|numberRange|boolean|constant|foreignKey","method":"person.firstName"}.${fkInfo ? ` FK columns must use "foreignKey" strategy.${fkInfo}` : ''} For JSON columns use "constant" with a sample object.`;
            return await this._callAI(simplePrompt);
        } catch (err: any) {
            console.warn(`[BlueprintGenerator] AI attempt 2 failed for ${table.name}: ${err.message}`);
        }

        // Layer 3: DETERMINISTIC fallback — guaranteed, zero AI
        console.warn(`[BlueprintGenerator] Using deterministic fallback for ${table.name}`);
        return this._generateDeterministicBlueprint(table);
    },

    /**
     * Deterministic blueprint generator — no AI calls, instant, guaranteed to work.
     * Creates strategy rules purely from column metadata.
     */
    _generateDeterministicBlueprint(table: any): ColumnBlueprint[] {
        const fkMap = new Map<string, { referenceTable: string; referenceColumn: string }>();
        if (table.foreignKeys) {
            for (const fk of table.foreignKeys) {
                fkMap.set(fk.column, { referenceTable: fk.referenceTable, referenceColumn: fk.referenceColumn });
            }
        }

        return table.columns.map((col: any) => {
            const name = col.name;
            const type = (col.type || 'string').toLowerCase();
            const isPrimary = col.isPrimary || false;
            const fk = fkMap.get(name);

            // FK columns — always use foreignKey strategy
            if (fk) {
                return { name, strategy: 'foreignKey', referenceTable: fk.referenceTable, referenceColumn: fk.referenceColumn };
            }

            // Primary keys
            if (isPrimary) {
                if (type === 'integer' || type === 'number') {
                    return { name, strategy: 'autoIncrement', startAt: 1 };
                }
                return { name, strategy: 'uuid' };
            }

            // Type-based strategies
            switch (type) {
                case 'integer':
                    return { name, strategy: 'numberRange', min: 1, max: 10000, precision: 0 };
                case 'number':
                    return { name, strategy: 'numberRange', min: 0, max: 100000, precision: 2 };
                case 'boolean':
                    return { name, strategy: 'boolean', probability: 0.5 };
                case 'date':
                    return { name, strategy: 'dateRange', from: '2020-01-01', to: '2025-12-31' };
                case 'timestamp':
                    return { name, strategy: 'dateRange', from: '2020-01-01', to: '2025-12-31' };
                case 'uuid':
                    return { name, strategy: 'uuid' };
                case 'json':
                    return { name, strategy: 'constant', value: { key: 'value', status: 'active' } };
                case 'time':
                    return { name, strategy: 'faker', method: 'date.recent' };
                default: {
                    // Smart name-based heuristics for string columns
                    const lowerName = name.toLowerCase();
                    if (lowerName.includes('email')) return { name, strategy: 'faker', method: 'internet.email' };
                    if (lowerName.includes('phone')) return { name, strategy: 'faker', method: 'phone.number' };
                    if (lowerName.includes('url') || lowerName.includes('link') || lowerName.includes('logo')) return { name, strategy: 'faker', method: 'internet.url' };
                    if (lowerName.includes('city')) return { name, strategy: 'faker', method: 'location.city' };
                    if (lowerName.includes('country')) return { name, strategy: 'faker', method: 'location.country' };
                    if (lowerName.includes('state')) return { name, strategy: 'faker', method: 'location.state' };
                    if (lowerName.includes('address')) return { name, strategy: 'faker', method: 'location.streetAddress' };
                    if (lowerName.includes('zip') || lowerName.includes('postal')) return { name, strategy: 'faker', method: 'location.zipCode' };
                    if (lowerName.includes('first_name') || lowerName.includes('firstname')) return { name, strategy: 'faker', method: 'person.firstName' };
                    if (lowerName.includes('last_name') || lowerName.includes('lastname')) return { name, strategy: 'faker', method: 'person.lastName' };
                    if (lowerName.includes('full_name') || lowerName.includes('fullname') || lowerName.includes('_name')) return { name, strategy: 'faker', method: 'person.fullName' };
                    if (lowerName.includes('status')) return { name, strategy: 'enum', values: ['active', 'inactive', 'pending'], weights: [50, 30, 20] };
                    if (lowerName.includes('type') || lowerName.includes('category') || lowerName.includes('role')) return { name, strategy: 'faker', method: 'lorem.word' };
                    if (lowerName.includes('description') || lowerName.includes('notes') || lowerName.includes('details') || lowerName.includes('report')) return { name, strategy: 'faker', method: 'lorem.sentence' };
                    if (lowerName.includes('hash')) return { name, strategy: 'faker', method: 'string.alphanumeric' };
                    if (lowerName.includes('ssn') || lowerName.includes('passport') || lowerName.includes('tax_id')) return { name, strategy: 'faker', method: 'string.alphanumeric' };
                    return { name, strategy: 'faker', method: 'lorem.word' };
                }
            }
        });
    },

    async _callAI(prompt: string): Promise<ColumnBlueprint[]> {
        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: prompt }],
            temperature: 0.3,
            response_format: { type: 'json_object' },
            max_tokens: 4096,
        });

        const output = response.choices[0].message.content?.trim();
        if (!output) throw new Error('Empty response');

        const parsed = JSON.parse(output);
        const blueprint = parsed.blueprint || (Array.isArray(parsed) ? parsed : null);
        if (!blueprint || !Array.isArray(blueprint)) {
            throw new Error('Blueprint is not an array');
        }
        return blueprint as ColumnBlueprint[];
    }
};

export interface ColumnBlueprint {
    name: string;
    strategy: 'autoIncrement' | 'faker' | 'template' | 'enum' | 'dateRange' | 'numberRange' | 'uuid' | 'boolean' | 'constant' | 'foreignKey';
    // Strategy-specific fields
    startAt?: number;
    method?: string;
    template?: string;
    values?: any[];
    weights?: number[];
    from?: string;
    to?: string;
    min?: number;
    max?: number;
    precision?: number;
    probability?: number;
    value?: any;
    referenceTable?: string;
    referenceColumn?: string;
}
