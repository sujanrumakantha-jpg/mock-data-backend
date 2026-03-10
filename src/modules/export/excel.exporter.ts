import ExcelJS from 'exceljs';

export const ExcelExporter = {
    async generateBuffer(dataStore: Record<string, any[]>) {
        const workbook = new ExcelJS.Workbook();

        Object.keys(dataStore).forEach(tableName => {
            const sheet = workbook.addWorksheet(tableName.substring(0, 31)); // excel sheets max length 31
            const rows = dataStore[tableName];

            if (rows && rows.length > 0) {
                const columns = Object.keys(rows[0]).map(key => ({
                    header: key,
                    key: key,
                    width: 20
                }));

                sheet.columns = columns;

                // Make headers bold
                sheet.getRow(1).font = { bold: true };

                sheet.addRows(rows);
            }
        });

        return await workbook.xlsx.writeBuffer();
    }
};
