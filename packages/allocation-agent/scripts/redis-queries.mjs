import Redis from "ioredis";

async function runRedisQueries() {
  // Try with TLS first, fallback to non-TLS if it fails
  let redis = null;
  try {
    redis = new Redis({
      host: process.env.REDIS_HOST || "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com",
      port: parseInt(process.env.REDIS_PORT || "17054", 10),
      password: process.env.REDIS_PASSWORD || "",
      tls: {},
      maxRetriesPerRequest: 1,
      connectTimeout: 5000,
      lazyConnect: true,
    });

    await redis.connect();
    console.log("Connected with TLS");
  } catch (tlsError) {
    console.log("TLS connection failed, trying without TLS...");
    if (redis) await redis.quit();

    redis = new Redis({
      host: process.env.REDIS_HOST || "redis-17054.c99.us-east-1-4.ec2.cloud.redislabs.com",
      port: parseInt(process.env.REDIS_PORT || "17054", 10),
      password: process.env.REDIS_PASSWORD || "",
      maxRetriesPerRequest: 3,
      connectTimeout: 5000,
    });
    console.log("Connected without TLS");
  }

  try {
    console.log("=== Redis Connection Info ===");
    const info = await redis.info("server");
    const serverVersion = info.match(/redis_version:([^\r\n]+)/)?.[1];
    console.log(`Redis Version: ${serverVersion}\n`);

    console.log("=== Database Size ===");
    const dbSize = await redis.dbsize();
    console.log(`Total Keys: ${dbSize}\n`);

    console.log("=== All Keys (sampled) ===");
    const allKeys = await redis.keys("*");
    console.log(`Found ${allKeys.length} keys total\n`);

    if (allKeys.length > 0) {
      console.log("Sample of keys:");
      allKeys.slice(0, 20).forEach(key => console.log(`  - ${key}`));
      if (allKeys.length > 20) {
        console.log(`  ... and ${allKeys.length - 20} more`);
      }
      console.log();
    }

    // Group keys by pattern
    console.log("=== Keys by Pattern ===");
    const patterns = {};
    allKeys.forEach(key => {
      const prefix = key.split(":")[0];
      patterns[prefix] = (patterns[prefix] || 0) + 1;
    });
    Object.entries(patterns).forEach(([prefix, count]) => {
      console.log(`  ${prefix}:* → ${count} keys`);
    });
    console.log();

    // Sample some actual data
    console.log("=== Sample Data ===");
    for (const key of allKeys.slice(0, 5)) {
      const type = await redis.type(key);
      console.log(`\nKey: ${key}`);
      console.log(`Type: ${type}`);

      switch (type) {
        case "string":
          const value = await redis.get(key);
          console.log(`Value: ${value?.substring(0, 200)}${value?.length > 200 ? "..." : ""}`);
          break;
        case "hash":
          const hash = await redis.hgetall(key);
          console.log(`Fields: ${Object.keys(hash).length}`);
          console.log(`Sample: ${JSON.stringify(hash, null, 2).substring(0, 300)}...`);
          break;
        case "list":
          const listLen = await redis.llen(key);
          const listSample = await redis.lrange(key, 0, 2);
          console.log(`Length: ${listLen}`);
          console.log(`Sample: ${JSON.stringify(listSample, null, 2)}`);
          break;
        case "set":
          const setSize = await redis.scard(key);
          const setSample = await redis.smembers(key);
          console.log(`Size: ${setSize}`);
          console.log(`Members: ${JSON.stringify(setSample.slice(0, 5))}`);
          break;
        case "zset":
          const zsetSize = await redis.zcard(key);
          const zsetSample = await redis.zrange(key, 0, 2, "WITHSCORES");
          console.log(`Size: ${zsetSize}`);
          console.log(`Sample: ${JSON.stringify(zsetSample)}`);
          break;
      }
    }

    // Look for specific application data patterns
    console.log("\n=== Application-Specific Queries ===");

    // Check for application keys
    const appKeys = await redis.keys("application:*");
    console.log(`\nApplications: ${appKeys.length} keys`);
    if (appKeys.length > 0) {
      console.log("Sample application keys:");
      appKeys.slice(0, 5).forEach(key => console.log(`  - ${key}`));

      // Get sample application data
      const sampleAppKey = appKeys[0];
      if (sampleAppKey) {
        const appData = await redis.hgetall(sampleAppKey);
        console.log(`\nSample application data (${sampleAppKey}):`);
        console.log(JSON.stringify(appData, null, 2));
      }
    }

    // Check for email verification keys
    const emailKeys = await redis.keys("email_verification:*");
    console.log(`\nEmail Verifications: ${emailKeys.length} keys`);
    if (emailKeys.length > 0) {
      console.log("Sample email verification keys:");
      emailKeys.slice(0, 3).forEach(key => console.log(`  - ${key}`));
    }

    // Check for submission tracking
    const submissionKeys = await redis.keys("submission:*");
    console.log(`\nSubmissions: ${submissionKeys.length} keys`);
    if (submissionKeys.length > 0) {
      console.log("Sample submission keys:");
      submissionKeys.slice(0, 3).forEach(key => console.log(`  - ${key}`));
    }

    // Check for bot status
    const statusKeys = await redis.keys("status:*");
    console.log(`\nStatus Keys: ${statusKeys.length} keys`);
    if (statusKeys.length > 0) {
      const statusData = await redis.get(statusKeys[0]);
      console.log(`Sample status: ${statusData}`);
    }

  } catch (error) {
    console.error("Error querying Redis:", error.message);
    if (error.stack) console.error(error.stack);
  } finally {
    await redis.quit();
  }
}

runRedisQueries();
