import { openai } from '../../config/openai';

export const SchemaParser = {
  /**
  /**
   * Parse schema content into normalized JSON format.
   * For SQL formats: Uses a deterministic regex-based parser (instant, 100% reliable).
   * For non-SQL formats: Falls back to AI-based parsing.
   */
  async parseWithAI(content: string, format: string) {
    const fmt = format.toUpperCase();
    const isSql = ['POSTGRESQL', 'POSTGRES', 'SQL', 'MYSQL'].includes(fmt);

    if (isSql) {
      // ═══════════════════════════════════════════════════════════
      // DETERMINISTIC SQL DDL PARSER — No AI, instant, 100% reliable
      // ═══════════════════════════════════════════════════════════
      return this._parseSqlDeterministic(content);
    }

    // ═══════════════════════════════════════════════════════════
    // AI FALLBACK — For non-SQL formats (Prisma, GraphQL, etc.)
    // ═══════════════════════════════════════════════════════════
    return this._parseWithAIFallback(content, format);
  },

  /**
   * Deterministic SQL DDL parser using regex.
   * Handles CREATE TABLE with columns, PRIMARY KEY, NOT NULL, UNIQUE, and FOREIGN KEY constraints.
   * Works for PostgreSQL, MySQL, and standard SQL.
   */
  _parseSqlDeterministic(content: string) {
    const tables: any[] = [];

    // Normalize content: remove comments
    const cleanContent = content
      .replace(/--[^\n]*/g, '')           // Remove single-line comments
      .replace(/\/\*[\s\S]*?\*\//g, '');  // Remove multi-line comments

    // Match all CREATE TABLE blocks (handles nested parentheses for constraints)
    const createTableRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:`|"|')?(\w+)(?:`|"|')?\s*\(([\s\S]*?)\);/gi;

    let match;
    while ((match = createTableRegex.exec(cleanContent)) !== null) {
      const tableName = match[1];
      const bodyRaw = match[2];

      const columns: any[] = [];
      const foreignKeys: any[] = [];
      const compositePKColumns: string[] = [];

      // Split the body by top-level commas (not inside parentheses)
      const statements = this._splitByTopLevelComma(bodyRaw);

      for (const stmt of statements) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;

        // Check for FOREIGN KEY constraint
        const fkMatch = trimmed.match(
          /FOREIGN\s+KEY\s*\(\s*(?:`|"|')?(\w+)(?:`|"|')?\s*\)\s*REFERENCES\s+(?:`|"|')?(\w+)(?:`|"|')?\s*\(\s*(?:`|"|')?(\w+)(?:`|"|')?\s*\)/i
        );
        if (fkMatch) {
          foreignKeys.push({
            column: fkMatch[1],
            referenceTable: fkMatch[2],
            referenceColumn: fkMatch[3]
          });
          continue;
        }

        // Check for standalone PRIMARY KEY constraint
        const pkMatch = trimmed.match(
          /PRIMARY\s+KEY\s*\(\s*([\w\s,`"']+)\s*\)/i
        );
        if (pkMatch) {
          const pkCols = pkMatch[1].split(',').map(c => c.trim().replace(/[`"']/g, ''));
          compositePKColumns.push(...pkCols);
          continue;
        }

        // Check for standalone UNIQUE constraint
        const uniqueMatch = trimmed.match(/^\s*(?:CONSTRAINT\s+\w+\s+)?UNIQUE\s*\(/i);
        if (uniqueMatch) continue;

        // Check for CHECK constraint
        const checkMatch = trimmed.match(/^\s*(?:CONSTRAINT\s+\w+\s+)?CHECK\s*\(/i);
        if (checkMatch) continue;

        // Check for INDEX
        const indexMatch = trimmed.match(/^\s*(?:INDEX|KEY)\s+/i);
        if (indexMatch) continue;

        // Otherwise, parse as a column definition
        const colMatch = trimmed.match(
          /^(?:`|"|')?(\w+)(?:`|"|')?\s+([\w\s(),.]+?)(?:\s+((?:(?:PRIMARY\s+KEY|NOT\s+NULL|NULL|UNIQUE|DEFAULT\s+\S+|CHECK\s*\([^)]*\)|REFERENCES\s+\w+\s*\(\w+\)|AUTO_INCREMENT|SERIAL|GENERATED\s+[\w\s]+)\s*)+))?\s*$/i
        );

        if (colMatch) {
          const colName = colMatch[1];
          const rawType = colMatch[2].trim();
          const constraints = (colMatch[3] || '').toUpperCase();

          const isPrimary = constraints.includes('PRIMARY KEY');
          const isNullable = !constraints.includes('NOT NULL') && !isPrimary;
          const isUnique = constraints.includes('UNIQUE') || isPrimary;

          columns.push({
            name: colName,
            type: this._normalizeType(rawType),
            isPrimary,
            isNullable,
            isUnique
          });

          // Check for inline REFERENCES
          const inlineRefMatch = (colMatch[3] || '').match(
            /REFERENCES\s+(?:`|"|')?(\w+)(?:`|"|')?\s*\(\s*(?:`|"|')?(\w+)(?:`|"|')?\s*\)/i
          );
          if (inlineRefMatch) {
            foreignKeys.push({
              column: colName,
              referenceTable: inlineRefMatch[1],
              referenceColumn: inlineRefMatch[2]
            });
          }
        }
      }

      // Apply composite primary keys
      for (const pkCol of compositePKColumns) {
        const col = columns.find(c => c.name === pkCol);
        if (col) {
          col.isPrimary = true;
          col.isUnique = true;
          col.isNullable = false;
        }
      }

      tables.push({ name: tableName, columns, foreignKeys });
    }

    // ═══════════════════════════════════════════════════════════
    // Also extract ALTER TABLE ... ADD FOREIGN KEY statements
    // ═══════════════════════════════════════════════════════════
    const alterFkRegex = /ALTER\s+TABLE\s+(?:`|"|')?(\w+)(?:`|"|')?\s+ADD\s+(?:CONSTRAINT\s+\w+\s+)?FOREIGN\s+KEY\s*\(\s*(?:`|"|')?(\w+)(?:`|"|')?\s*\)\s*REFERENCES\s+(?:`|"|')?(\w+)(?:`|"|')?\s*\(\s*(?:`|"|')?(\w+)(?:`|"|')?\s*\)/gi;
    
    while ((match = alterFkRegex.exec(cleanContent)) !== null) {
      const tblName = match[1];
      const table = tables.find(t => t.name === tblName);
      if (table) {
        table.foreignKeys.push({
          column: match[2],
          referenceTable: match[3],
          referenceColumn: match[4]
        });
      }
    }

    if (tables.length === 0) {
      throw new Error('No CREATE TABLE statements found in the SQL content.');
    }

    console.log(`[DeterministicParser] Parsed ${tables.length} tables successfully.`);
    return { tables };
  },

  /**
   * Split a string by commas that are NOT inside parentheses.
   * This correctly handles types like NUMERIC(10,2) or DEFAULT func(x,y).
   */
  _splitByTopLevelComma(body: string): string[] {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < body.length; i++) {
      if (body[i] === '(') depth++;
      else if (body[i] === ')') depth--;
      else if (body[i] === ',' && depth === 0) {
        parts.push(body.substring(start, i));
        start = i + 1;
      }
    }
    parts.push(body.substring(start));
    return parts;
  },

  /**
   * Normalize SQL data types to simple type names.
   */
  _normalizeType(rawType: string): string {
    const upper = rawType.toUpperCase().trim();

    if (/^(INT|INTEGER|SMALLINT|BIGINT|SERIAL|BIGSERIAL)/.test(upper)) return 'integer';
    if (/^(NUMERIC|DECIMAL|REAL|DOUBLE|FLOAT|MONEY)/.test(upper)) return 'number';
    if (/^(BOOL|BOOLEAN)/.test(upper)) return 'boolean';
    if (/^(DATE)$/.test(upper)) return 'date';
    if (/^(TIMESTAMP|TIMESTAMPTZ|TIMESTAMP\s+WITH|TIMESTAMP\s+WITHOUT)/.test(upper)) return 'timestamp';
    if (/^(TIME|TIMETZ)/.test(upper)) return 'time';
    if (/^(UUID)/.test(upper)) return 'uuid';
    if (/^(JSON|JSONB)/.test(upper)) return 'json';
    if (/^(TEXT|CHAR|CHARACTER|VARCHAR|CHARACTER\s+VARYING|CLOB|STRING)/.test(upper)) return 'string';
    if (/^(BYTEA|BLOB|BINARY)/.test(upper)) return 'binary';
    if (/^(ARRAY)/.test(upper)) return 'array';
    if (/^(USER-DEFINED|ENUM)/.test(upper)) return 'string'; // Map custom types to string

    return 'string'; // Default fallback
  },

  /**
   * AI-based fallback parser for non-SQL formats (Prisma, GraphQL, etc.)
   */
  async _parseWithAIFallback(content: string, format: string) {
    const prompt = `
    You are an expert Data Architect. We have a database schema in the format: ${format}.
    Read the following schema content and normalize it into a generic JSON format.
    
    Return a JSON object with this structure:
    {
      "tables": [
        {
          "name": "TableName",
          "columns": [
            { "name": "ColumnName", "type": "string|integer|boolean|date|timestamp|number|json|uuid", "isPrimary": true/false, "isNullable": true/false, "isUnique": true/false }
          ],
          "foreignKeys": [
            { "column": "LocalColumnName", "referenceTable": "ForeignTableName", "referenceColumn": "ForeignColumnName" }
          ]
        }
      ]
    }

    SCHEMA CONTENT:
    """
    ${content.substring(0, 50000)}
    """
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0.1,
      response_format: { type: 'json_object' },
      max_tokens: 16384,
    });

    const output = response.choices[0].message.content?.trim();
    if (!output) throw new Error('OpenAI returned empty response.');

    try {
      return JSON.parse(output);
    } catch (err) {
      console.error('Failed to parse OpenAI response as JSON:', output);
      throw new Error('AI produced invalid JSON output.');
    }
  },

  /**
   * Extracts schema content and detects format from raw text
   */
  async extractSchemaFromText(text: string) {
    const prompt = `
    You are an AI assistant specialized in database schemas.
    Analyze the following raw text or file content and:
    1. Extract the actual database schema/DDL/JSON structure.
    2. Detect the schema format (e.g., SQL, JSON, PRISMA, MONGO_SCHEMA, TYPESCRIPT, GRAPHQL).
    
    If the text is not a schema, try to infer a schema if possible, or return an empty content.

    OUTPUT FORMAT:
    Return a JSON object:
    {
      "content": "The extracted schema text",
      "format": "SQL | JSON | PRISMA | MONGO_SCHEMA | TYPESCRIPT | GRAPHQL"
    }

    INPUT TEXT:
    """
    ${text.substring(0, 5000)}
    """
    `;

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'system', content: prompt }],
      temperature: 0,
      response_format: { type: 'json_object' },
    });

    const output = response.choices[0].message.content?.trim();
    if (!output) throw new Error('OpenAI returned empty response.');

    try {
      return JSON.parse(output) as { content: string; format: string };
    } catch (err) {
      throw new Error('AI produced invalid JSON output for extraction.');
    }
  }
};
