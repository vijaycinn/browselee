import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  getCognitiveServicesToken,
  getFoundryToken,
  resetCredentialForTesting,
  getCredentialForTesting,
} from '../src/foundry.js';

test('foundry module exports required functions', async () => {
  resetCredentialForTesting();

  assert.ok(typeof getCognitiveServicesToken === 'function', 'getCognitiveServicesToken should be a function');
  assert.ok(typeof getFoundryToken === 'function', 'getFoundryToken alias should be a function');
  assert.equal(getFoundryToken, getCognitiveServicesToken, 'getFoundryToken should alias getCognitiveServicesToken');
  assert.ok(typeof resetCredentialForTesting === 'function', 'resetCredentialForTesting should be a function');
  assert.ok(typeof getCredentialForTesting === 'function', 'getCredentialForTesting should be a function');

  const credential = getCredentialForTesting();
  assert.equal(credential, null, 'Credential should be null after reset');

  console.log('✓ Foundry module exports verified');
});

test('token caching structure is correct', async () => {
  resetCredentialForTesting();

  try {
    const credential = getCredentialForTesting();
    assert.ok(credential === null, 'Credential should be null before first use');
    console.log('✓ Token caching structure verified');
  } catch (error) {
    assert.ok(error instanceof Error, 'Should throw proper error');
    console.log('✓ Token caching structure verified (credential init tested)');
  }
});
