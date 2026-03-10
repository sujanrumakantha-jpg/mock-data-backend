import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { initWorker } from './modules/jobs/worker';

const PORT = process.env.PORT || 5000;

const startServer = async () => {
    // Initialize Background Workers
    initWorker();

    app.listen(PORT, () => {
        console.log(`Server is running on port ${PORT}`);
    });
};

startServer().catch(err => {
    console.error('Failed to start server:', err);
});
