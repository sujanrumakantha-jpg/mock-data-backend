import { Request, Response, NextFunction } from 'express';
import { ExcelExporter } from './excel.exporter';
import { CSVExporter } from './csv.exporter';
import { PDFExporter } from './pdf.exporter';
import { generationQueue } from '../jobs/queue';

export const ExportController = {
    async exportData(req: Request, res: Response, next: NextFunction) {
        try {
            const { format, dataStore, jobId } = req.body;

            // Support both direct dataStore and jobId-based lookup
            let data = dataStore;
            if (!data && jobId) {
                const job = await generationQueue.getJob(jobId);
                if (job && job.returnvalue) {
                    data = job.returnvalue;
                }
            }

            if (!format || !data) {
                return res.status(400).json({ error: 'Format and dataStore (or jobId) are required.' });
            }

            switch (format) {
                case 'json':
                    res.setHeader('Content-Type', 'application/json');
                    res.setHeader('Content-Disposition', 'attachment; filename="synthetic_data.json"');
                    // Stream JSON table-by-table to avoid buffering entire dataset
                    const tableNames = Object.keys(data);
                    res.write('{\n');
                    for (let i = 0; i < tableNames.length; i++) {
                        const tName = tableNames[i];
                        res.write(`  ${JSON.stringify(tName)}: ${JSON.stringify(data[tName])}`);
                        if (i < tableNames.length - 1) res.write(',\n');
                    }
                    res.write('\n}');
                    return res.end();

                case 'excel':
                    const excelBuffer = await ExcelExporter.generateBuffer(data);
                    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                    res.setHeader('Content-Disposition', 'attachment; filename="synthetic_data.xlsx"');
                    return res.status(200).send(excelBuffer);

                case 'csv':
                    // For simplicity, we just take the first table, or we can send a zip
                    const tableName = Object.keys(data)[0];
                    if (!tableName) return res.status(400).json({ error: 'No data to export' });
                    const csvString = await CSVExporter.generateString(tableName, data[tableName]);
                    res.setHeader('Content-Type', 'text/csv');
                    res.setHeader('Content-Disposition', `attachment; filename="${tableName}.csv"`);
                    return res.status(200).send(csvString);

                case 'pdf':
                    const pdfBuffer = await PDFExporter.generateBuffer(data);
                    res.setHeader('Content-Type', 'application/pdf');
                    res.setHeader('Content-Disposition', 'attachment; filename="report.pdf"');
                    return res.status(200).send(pdfBuffer);

                default:
                    return res.status(400).json({ error: 'Unsupported format' });
            }

        } catch (error) {
            next(error);
        }
    }
};
