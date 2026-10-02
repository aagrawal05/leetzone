// Secrets are not in wrangler.jsonc, so `wrangler types` cannot see them.
// Merged into the generated Env (worker-configuration.d.ts).

interface Env {
  /** Shared invite code needed to create a player. Unset means no gate. */
  INVITE_CODE?: string;
}
