import { DefaultAzureCredential, ManagedIdentityCredential } from '@azure/identity';
import { OpenAI } from 'openai';

interface CachedToken {
  token: string;
  expiresAt: number;
}

let cachedToken: CachedToken | null = null;
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

export async function getFoundryToken(): Promise<string> {
  const now = Date.now();

  // If token exists and isn't expiring in the next 5 minutes, return it
  if (cachedToken && cachedToken.expiresAt > now + 5 * 60 * 1000) {
    return cachedToken.token;
  }

  const credential = getCredential();
  const tokenResponse = await credential.getToken('https://cognitiveservices.azure.com/.default');

  cachedToken = {
    token: tokenResponse.token,
    expiresAt: tokenResponse.expiresOnTimestamp * 1000,
  };

  return tokenResponse.token;
}

export async function buildOpenAIClient(): Promise<OpenAI> {
  const endpoint = process.env.FOUNDRY_ENDPOINT;
  if (!endpoint) {
    throw new Error('FOUNDRY_ENDPOINT environment variable is required');
  }

  const token = await getFoundryToken();

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
  cachedToken = null;
}
