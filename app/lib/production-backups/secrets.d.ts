// Runtime secrets are configured with Wrangler, not committed in configuration.
interface CloudflareEnv {
  BACKUP_API_TOKEN?: string;
  // This is separate from the Cloudflare API token. It authorizes the local
  // development Worker to call the deployed backup card after Access has
  // authenticated its service token.
  LOCAL_BACKUP_BRIDGE_SECRET?: string;
}
