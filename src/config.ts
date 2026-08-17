import { homedir } from "node:os";
import { resolve } from "node:path";

export function resolveFolioHome(
  env: NodeJS.ProcessEnv = process.env,
  dataDirectory: string | null = null,
  cwd = process.cwd(),
): string {
  const cliDirectory = dataDirectory?.trim();
  if (cliDirectory) return resolve(cwd, cliDirectory);

  const explicit = env.FOLIO_HOME?.trim();
  if (explicit) return resolve(explicit);

  const xdg = env.XDG_DATA_HOME?.trim();
  if (xdg) return resolve(xdg, "folio");

  return resolve(homedir(), ".local", "share", "folio");
}
