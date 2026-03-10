import * as fastcsv from 'fast-csv';

export const CSVExporter = {
    /**
     * Generates a CSV string for a single table. 
     * If there are multiple tables in dataStore, you might want to return a zip containing multiple CSVs
     * or a merged CSV depending on the user requirements.
     */
    async generateString(tableName: string, rows: any[]): Promise<string> {
        return new Promise((resolve, reject) => {
            const csvStream = fastcsv.format({ headers: true });
            let output = '';

            csvStream.on('data', chunk => { output += chunk; });
            csvStream.on('end', () => resolve(output));
            csvStream.on('error', err => reject(err));

            rows.forEach(row => {
                csvStream.write(row);
            });

            csvStream.end();
        });
    }
};
