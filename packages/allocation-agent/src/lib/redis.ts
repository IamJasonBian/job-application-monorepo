import Redis from "ioredis";

let client: Redis | null = null;

export function getRedisClient(): Redis {
  if (client) return client;

  client = new Redis({
    host: process.env.REDIS_HOST || "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com",
    port: parseInt(process.env.REDIS_PORT || "17054", 10),
    password: process.env.REDIS_PASSWORD || "",
    maxRetriesPerRequest: 3,
    connectTimeout: 5000,
    commandTimeout: 10000,
  });

  return client;
}

export async function disconnectRedis(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}
