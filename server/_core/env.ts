export const ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? "",
  // Infrastructure connectivity — set these in production secrets
  kafkaBrokers: process.env.KAFKA_BROKERS ?? "localhost:9092",
  redisUrl: process.env.REDIS_URL ?? "redis://localhost:6379",
  // KEDA namespace — used when generating kubectl bootstrap instructions
  kedaNamespace: process.env.KEDA_NAMESPACE ?? "nexcom",
};
