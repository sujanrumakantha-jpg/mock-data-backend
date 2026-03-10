# API Documentation

Base URL: `http://localhost:5000/api`

## Schema Module
Handles database schema uploads and parsing.

### `POST /schema/upload`
Uploads a new raw schema to be parsed by OpenAI.
**Body:**
```json
{
  "format": "SQL", // SQL | Prisma | Sequelize | MongoDB
  "schemaContent": "CREATE TABLE users ( id INT PRIMARY KEY, name VARCHAR(50) );"
}
```
**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "_id": "64abcdef1234567890",
    "status": "PARSED",
    "normalizedSchema": {
      "tables": [ ... ]
    }
  }
}
```

### `GET /schema/:schemaId/questions`
Retrieves dynamic configuration questions based on the parsed schema.
**Response (200 OK):** Array of objects representing form fields (rows per table, realism level, etc.).

---

## Generation Module
Handles the background generation jobs.

### `POST /generate/start`
Starts a new synthetic data generation job via BullMQ.
**Body:**
```json
{
  "schemaId": "64abcdef1234567890",
  "config": {
    "rows": 100,
    "industry": "Healthcare",
    "strictReferential": true,
    "edgeCases": false,
    "realism": "High"
  }
}
```
**Response (202 Accepted):**
```json
{
  "success": true,
  "message": "Generation job started.",
  "jobId": "job_64abcdef_1688000000"
}
```

### `GET /generate/status/:jobId`
Polls the completion progress of the generation job.
**Response (200 OK):**
```json
{
  "jobId": "job_64abcdef_1688000000",
  "status": "in-progress", // pending, in-progress, completed, failed
  "progress": 45
}
```

---

## Export Module
Exports generated data in various formats.

### `POST /export`
Triggers an export using the requested format.
**Body:**
```json
{
  "format": "excel", // excel, csv, pdf, json
  "dataStore": {
    "users": [ { "id": 1, "name": "John" } ]
  }
}
```
**Response (200 OK):** Returns a downloadable Blob/Buffer (e.g., `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`).
