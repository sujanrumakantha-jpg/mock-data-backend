import { openai } from '../../config/openai';

const BATCH_SIZE = 50; // Max rows per API call to stay within token limits
const PARALLEL_BATCHES = 2; // Reduced to avoid rate limits
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 2000; // 2 second base delay between retries

/**
 * Sleep for a given number of milliseconds.
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export const OpenAIGenerator = {
    /**
     * Generate data for a table, automatically chunking large requests.
     * Accepts an optional onBatchComplete callback for granular progress.
     */
    async generateTableData(
        table: any,
        config: any,
        foreignKeysContext: any,
        onBatchComplete?: (batchRows: number, totalSoFar: number, totalExpected: number) => void
    ) {
        const totalRows = config.rows || 10;

        if (totalRows <= BATCH_SIZE) {
            const result = await this._generateBatchWithRetry(table, config, foreignKeysContext, totalRows);
            if (onBatchComplete) onBatchComplete(result.length, result.length, totalRows);
            return result;
        }

        // Large request — split into batches
        const batches: number[] = [];
        let remaining = totalRows;
        while (remaining > 0) {
            const batchSize = Math.min(remaining, BATCH_SIZE);
            batches.push(batchSize);
            remaining -= batchSize;
        }

        console.log(`[${table.name}] Splitting ${totalRows} rows into ${batches.length} batches of ~${BATCH_SIZE} (${PARALLEL_BATCHES} parallel)`);

        const allRows: any[] = [];

        // Process batches in sequential waves of PARALLEL_BATCHES
        for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
            const wave = batches.slice(i, i + PARALLEL_BATCHES);
            const waveNum = Math.floor(i / PARALLEL_BATCHES) + 1;

            const waveResults = await Promise.all(
                wave.map((batchSize) =>
                    this._generateBatchWithRetry(table, config, foreignKeysContext, batchSize)
                )
            );

            for (const rows of waveResults) {
                allRows.push(...rows);
            }

            if (onBatchComplete) {
                onBatchComplete(wave.reduce((a, b) => a + b, 0), allRows.length, totalRows);
            }

            console.log(`[${table.name}] Wave ${waveNum} done, ${allRows.length}/${totalRows} rows`);

            // Small delay between waves to avoid rate limiting
            if (i + PARALLEL_BATCHES < batches.length) {
                await sleep(500);
            }
        }

        return allRows;
    },

    /**
     * Wrapper with retry logic and exponential backoff.
     */
    async _generateBatchWithRetry(table: any, config: any, foreignKeysContext: any, numRows: number): Promise<any[]> {
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            try {
                return await this._generateBatch(table, config, foreignKeysContext, numRows);
            } catch (err: any) {
                const isRateLimit = err?.status === 429 || err?.message?.includes('429') || err?.message?.includes('Rate limit');
                const isServerError = err?.status === 500 || err?.status === 503;

                if ((isRateLimit || isServerError) && attempt < MAX_RETRIES) {
                    const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1); // 2s, 4s, 8s
                    console.warn(`[${table.name}] Attempt ${attempt}/${MAX_RETRIES} failed (${isRateLimit ? 'rate limit' : 'server error'}). Retrying in ${delay}ms...`);
                    await sleep(delay);
                    continue;
                }

                // If it's a parse error, retry once more with a shorter batch
                if (err.message?.includes('invalid JSON') && attempt < MAX_RETRIES) {
                    console.warn(`[${table.name}] Parse error on attempt ${attempt}. Retrying...`);
                    await sleep(1000);
                    continue;
                }

                console.error(`[${table.name}] All ${MAX_RETRIES} attempts failed. Last error: ${err.message}`);
                throw err;
            }
        }
        throw new Error(`[${table.name}] Exhausted all retry attempts.`);
    },

    /**
     * Generate a single batch of rows via OpenAI.
     */
    async _generateBatch(table: any, config: any, foreignKeysContext: any, numRows: number): Promise<any[]> {
        let fkInstruction = '';
        if (foreignKeysContext) {
            fkInstruction = `
        IMPORTANT REFERENTIAL INTEGRITY CONSTRAINTS:
        ${JSON.stringify(foreignKeysContext)}
        You must pick values for the given local columns STRICTLY from the "validSamples" array provided.
      `;
        }

        const prompt = `
    Generate EXACTLY ${numRows} rows of synthetic JSON data for the table "${table.name}".
    
    Industry context: ${config.industry || 'Generic'}
    Realism level: ${config.realism || 'Medium'}
    
    Columns:
    ${JSON.stringify(table.columns)}

    ${fkInstruction}

    CRITICAL REQUIREMENT:
    Your response must contain exactly ${numRows} objects in the array. 
    Do not truncate or shorten the list for any reason.
    Every object must follow the schema provided.

    Output format:
    Provide ONLY a valid JSON Array containing objects representing the rows. Do not wrap in markdown tags.
    `;

        const response = await openai.chat.completions.create({
            model: 'gpt-4o',
            messages: [{ role: 'system', content: prompt }],
            temperature: config.realism === 'High' ? 0.8 : 0.4,
        });

        const output = response.choices[0].message.content?.trim();
        if (!output) throw new Error('OpenAI returned empty response.');

        let pureJsonStr = output;
        if (pureJsonStr.startsWith('```')) {
            pureJsonStr = pureJsonStr.replace(/^```json?/, '').replace(/```$/, '').trim();
        }

        try {
            const parsed = JSON.parse(pureJsonStr);
            if (!Array.isArray(parsed)) {
                throw new Error('Response is not a JSON array');
            }
            return parsed;
        } catch (err) {
            console.error(`Failed to parse batch response for ${table.name}:`, pureJsonStr.substring(0, 300));
            throw new Error('AI produced invalid JSON output.');
        }
    }
};
