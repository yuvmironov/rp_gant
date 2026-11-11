const DEFAULT_PORT = 8080;
const DEFAULT_KAFKA_TOPIC = 'rp_gant.events';
const LOCAL_SYNC_TOKEN_SECRET = 'local-sync-secret';
const DEPLOYMENT_PLACEHOLDER_SECRETS = new Set([LOCAL_SYNC_TOKEN_SECRET, 'CHANGE_ME_RANDOM_HEX']);

export function getKafkaTopic(env = process.env) {
  const topic = typeof env.KAFKA_TOPIC === 'string' ? env.KAFKA_TOPIC.trim() : '';
  return topic || DEFAULT_KAFKA_TOPIC;
}

export function getSyncTokenSecret(env = process.env) {
  const secret = typeof env.SYNC_TOKEN_SECRET === 'string' ? env.SYNC_TOKEN_SECRET.trim() : '';
  const runtimeEnv = env.RPGANT_ENV ?? env.NODE_ENV ?? 'development';
  const isLocal = ['development', 'test', 'local'].includes(runtimeEnv);

  if (!secret) {
    if (isLocal) return LOCAL_SYNC_TOKEN_SECRET;
    throw new Error('sync_token_secret_required');
  }

  if (!isLocal) {
    if (DEPLOYMENT_PLACEHOLDER_SECRETS.has(secret)) {
      throw new Error('sync_token_secret_not_configured');
    }
  }

  return secret;
}

export function loadConfig(env = process.env, defaults = {}) {
  const port = Number(env.PORT ?? defaults.port ?? DEFAULT_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`invalid_port:${env.PORT ?? defaults.port ?? DEFAULT_PORT}`);
  }

  return {
    host: env.HOST ?? defaults.host ?? '0.0.0.0',
    logLevel: env.LOG_LEVEL ?? defaults.logLevel ?? 'info',
    nodeEnv: env.NODE_ENV ?? defaults.nodeEnv ?? 'development',
    port,
  };
}
