import { readFileSync, existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

function loadEnv() {
  const out = {};
  if (!existsSync(".env")) return out;
  for (const line of readFileSync(".env", "utf8").split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const i = line.indexOf("=");
    if (i < 0) continue;
    out[line.slice(0, i)] = line.slice(i + 1).replace(/^"|"$/g, "");
  }
  return out;
}

const env = loadEnv();
const tokenPath = join(homedir(), ".supabase", "access-token");
console.log("env_keys", Object.keys(env).sort().join(", "));
console.log("has_env_access_token", Boolean(env.SUPABASE_ACCESS_TOKEN));
console.log("has_service_role", Boolean(env.SUPABASE_SERVICE_ROLE_KEY));
console.log("project", env.SUPABASE_PROJECT_ID || env.VITE_SUPABASE_PROJECT_ID || "missing");
console.log("cli_token_file", existsSync(tokenPath));
