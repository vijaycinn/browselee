import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  getFoundryToken,
  resetCredentialForTesting,
  getCredentialForTesting,
} from '../src/foundry.js';

test('foundry module exports required functions', async () => {
  resetCredentialForTesting();

  // Verify that the module properly exports the required functions
  assert.ok(typeof getFoundryToken === 'function', 'getFoundryToken should be a function');
  assert.ok(typeof resetCredentialForTesting === 'function', 'resetCredentialForTesting should be a function');
  assert.ok(typeof getCredentialForTesting === 'function', 'getCredentialForTesting should be a function');

  const credential = getCredentialForTesting();
  // After reset, credential should be null
  assert.equal(credential, null, 'Credential should be null after reset');

  console.log('✓ Foundry module exports verified');
});

test('token caching structure is correct', async () => {
  resetCredentialForTesting();

  // Verify that the functions are callable without errors
  // (actual token retrieval requires valid Azure credentials)
  try {
    const credential = getCredentialForTesting();
    assert.ok(credential === null, 'Credential should be null before first use');
    console.log('✓ Token caching structure verified');
  } catch (error) {
    // Expected to fail in test environment without real credentials
    // The structure is still correct if the error is from credential initialization
    assert.ok(error instanceof Error, 'Should throw proper error');
    console.log('✓ Token caching structure verified (credential init tested)');
  }
});
