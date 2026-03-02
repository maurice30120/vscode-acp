import { log, logError } from '../utils/Logger';

interface RegistryAgent {
  name: string;
  description?: string;
  command: string;
  args?: string[];
  homepage?: string;
}

interface Registry {
  agents: RegistryAgent[];
}

const REGISTRY_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';

let cachedRegistry: Registry | null = null;
let cacheTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // Cache conserve pendant 5 minutes

/**
 * Recupere le registre des agents ACP depuis le CDN officiel.
 * Les resultats sont mis en cache pour limiter les appels reseau.
 */
export async function fetchRegistry(): Promise<RegistryAgent[]> {
  const now = Date.now();
  if (cachedRegistry && (now - cacheTime) < CACHE_TTL) {
    return cachedRegistry.agents;
  }

  try {
    log('Fetching ACP agent registry...');
    const response = await fetch(REGISTRY_URL);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
    const data = (await response.json()) as Registry;
    cachedRegistry = data;
    cacheTime = now;
    log(`Registry fetched: ${data.agents?.length || 0} agents`);
    return data.agents || [];
  } catch (e) {
    logError('Failed to fetch registry', e);
    return cachedRegistry?.agents || [];
  }
}

/**
 * Vide explicitement le cache du registre.
 */
export function clearRegistryCache(): void {
  cachedRegistry = null;
  cacheTime = 0;
}
