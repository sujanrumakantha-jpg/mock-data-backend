import Redis from 'ioredis';

const redisHost = process.env.REDIS_HOST || 'localhost';
const redisPort = parseInt(process.env.REDIS_PORT || '6379', 10);

export const redisClient = new Redis({
    host: redisHost,
    port: redisPort,
    maxRetriesPerRequest: null,
});

redisClient.on('connect', () => {
    console.log('Redis Connected...');
});

redisClient.on('error', (err) => {
    console.log('Redis Client Error', err);
});
