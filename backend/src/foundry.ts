import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { OpenAI } from 'openai';

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Separate caches: cognitiveservices.azure.com scope (chat) vs ai.azure.com scope (realtime)
let cachedCogServicesToken: CachedToken | null = null;
let cachedAiAzureToken: CachedToken | null = null;
let credentialInstance: DefaultAzureCredential | ManagedIdentityCredential | null = null;

function getCredential(): DefaultAzureCredential | ManagedIdentityCredential {
  if (!credentialInstance) {
    if (process.env.AZURE_CLIENT_ID) {
      credentialInstance = new ManagedIdentityCredential(process.env.AZURE_CLIENT_ID);
    } else {
      credentialInstance = new DefaultAzureCredential();
    }
  }
  return credentialInstance;
}

/** Acquires a token scoped to cognitiveservices.azure.com — used by the text-chat OpenAI client. */
export async function getCognitiveServicesToken(): Promise<string> {
  const now = Date.now();
  if (cachedCogServicesToken && cachedCogServicesToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedCogServicesToken.token;
  }
  const credential = getCredential();
  const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');
  cachedCogServicesToken = {
    token: tokenResponse.token,
    expiresAt: tokenResponse.expiresOnTimestamp * 1000,
  };
  return tokenResponse.token;
}

/** Backward-compat alias. */
export const getFoundryToken = getCognitiveServicesToken;

/**
 * Acquires a token scoped to ai.azure.com — REQUIRED for the Realtime client_secrets endpoint.
 * Do NOT reuse the cognitiveservices token here; the Realtime API returns 401 if the wrong scope is used.
 */
export async function getAiAzureToken(): Promise<string> {
  const now = Date.now();
  if (cachedAiAzureToken && cachedAiAzureToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedAiAzureToken.token;
  }
  const credential = getCredential();
  const tokenResponse = await credential.getToken('https://ai.azure.com/.default');
  cachedAiAzureToken = {
    token: tokenResponse.token,
    expiresAt: tokenResponse.expiresOnTimestamp * 1000,
  };
  return tokenResponse.token;
}

/**
 * Derives the .openai.azure.com hostname from a .services.ai.azure.com hostname.
 * Both DNS names resolve to the same Cognitive Services account.
 * The client_secrets endpoint is documented on .openai.azure.com per the GA spec.
 *
 * Verified hostname mapping:
 *   smec-poc-vcinn-resource.services.ai.azure.com → smec-poc-vcinn-resource.openai.azure.com ✓
 *   smec-poc-vcinn-resource.openai.azure.com      → smec-poc-vcinn-resource.openai.azure.com (pass-through) ✓
 */
export function deriveOpenAiHost(servicesAiHost: string): string {
  const host = servicesAiHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
  if (host.includes('.openai.azure.com')) {
    return host;
  }
  if (host.includes('.services.ai.azure.com')) {
    return host.replace('.services.ai.azure.com', '.openai.azure.com');
  }
  throw new Error(
    `Cannot derive .openai.azure.com host from "${servicesAiHost}". ` +
      'Expected a .services.ai.azure.com or .openai.azure.com hostname.',
  );
}

/** Returns the base URL for Realtime API calls, e.g. https://smec-poc-vcinn-resource.openai.azure.com */
export function getRealtimeBaseUrl(): string {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  if (!endpoint) {
    throw new Error('FOUNDRY_ENDPOINT environment variable is required');
  }
  const host = deriveOpenAiHost(endpoint);
  return `https://${host}`;
}

export async function buildOpenAIClient(): Promise<OpenAI> {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  if (!endpoint) {
    throw new Error('FOUNDRY_ENDPOINT environment variable is required');
  }

  const token = await getCognitiveServicesToken();

  return new OpenAI({
    baseURL: `${endpoint}/openai/v1`,
    apiKey: 'unused', // AAD token via defaultHeaders
    defaultQuery: { 'api-version': 'preview' },
    defaultHeaders: { Authorization: `Bearer ${token}` },
  });
}

export function getCredentialForTesting(): DefaultAzureCredential | ManagedIdentityCredential | null {
  return credentialInstance;
}

export function resetCredentialForTesting(): void {
  credentialInstance = null;
  cachedCogServicesToken = null;
  cachedAiAzureToken = null;
}

/** Injects a fake ai.azure.com token for testing without real AAD credentials. */
export function setAiAzureTokenForTesting(token: string | null): void {
  if (token === null) {
    cachedAiAzureToken = null;
  } else {
    cachedAiAzureToken = { token, expiresAt: Date.now() + 60 * 60 * 1000 };
  }
}
