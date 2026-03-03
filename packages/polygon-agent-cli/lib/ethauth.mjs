import { ethers } from 'ethers';

// ETHAuth constants
const ETH_AUTH_VERSION = '1';
const ETH_AUTH_PREFIX = 'eth';

// EIP-712 Domain for ETHAuth
const ETH_AUTH_DOMAIN = {
  name: 'ETHAuth',
  version: '1'
};

/**
 * Build the EIP-712 typed data structure for signing
 */
function buildTypedData(claims) {
  const types = [];
  const message = {};

  if (claims.app && claims.app.length > 0) {
    types.push({ name: 'app', type: 'string' });
    message['app'] = claims.app;
  }

  if (claims.iat && claims.iat > 0) {
    types.push({ name: 'iat', type: 'int64' });
    message['iat'] = claims.iat;
  }

  if (claims.exp && claims.exp > 0) {
    types.push({ name: 'exp', type: 'int64' });
    message['exp'] = claims.exp;
  }

  if (claims.n && claims.n > 0) {
    types.push({ name: 'n', type: 'uint64' });
    message['n'] = claims.n;
  }

  if (claims.typ && claims.typ.length > 0) {
    types.push({ name: 'typ', type: 'string' });
    message['typ'] = claims.typ;
  }

  if (claims.ogn && claims.ogn.length > 0) {
    types.push({ name: 'ogn', type: 'string' });
    message['ogn'] = claims.ogn;
  }

  if (claims.v && claims.v.length > 0) {
    types.push({ name: 'v', type: 'string' });
    message['v'] = claims.v;
  }

  return {
    domain: ETH_AUTH_DOMAIN,
    types: { Claims: types },
    message,
    primaryType: 'Claims'
  };
}

/**
 * Encode claims to Base64 (URL-safe)
 */
function encodeClaimsToBase64(claims) {
  const json = JSON.stringify(claims);
  // URL-safe base64 encoding
  return Buffer.from(json).toString('base64url');
}

/**
 * Generate an ETHAuth proof string for authentication
 *
 * This creates a signed proof that can be used to authenticate with the Builder API.
 * The proof contains claims about the app, expiration time, and is signed by the wallet.
 *
 * Format: eth.<address>.<base64-claims>.<signature>
 *
 * @param privateKey - The private key to sign with
 * @param customClaims - Optional custom claims (defaults will be used if not provided)
 * @returns The encoded proof string
 */
export async function generateEthAuthProof(privateKey, customClaims) {
  const prefixedKey = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;

  const wallet = new ethers.Wallet(prefixedKey);
  const now = Math.floor(Date.now() / 1000);

  // Build claims with defaults
  const claims = {
    app: customClaims?.app || 'sequence-builder',
    iat: customClaims?.iat || now,
    exp: customClaims?.exp || now + 3600, // 1 hour expiration
    v: ETH_AUTH_VERSION,
    ...(customClaims?.n && { n: customClaims.n }),
    ...(customClaims?.typ && { typ: customClaims.typ }),
    ...(customClaims?.ogn && { ogn: customClaims.ogn })
  };

  // Build the typed data
  const typedData = buildTypedData(claims);

  // Sign the typed data using EIP-712
  const signature = await wallet.signTypedData(
    typedData.domain,
    typedData.types,
    typedData.message
  );

  // Encode the proof string: eth.<address>.<base64-claims>.<signature>
  const address = wallet.address.toLowerCase();
  const encodedClaims = encodeClaimsToBase64(claims);
  const proofString = `${ETH_AUTH_PREFIX}.${address}.${encodedClaims}.${signature}`;

  return proofString;
}

/**
 * Generate an ETHAuth proof with custom expiration
 *
 * @param privateKey - The private key to sign with
 * @param expirationSeconds - How long the proof should be valid (in seconds)
 * @returns The encoded proof string
 */
export async function generateEthAuthProofWithExpiration(privateKey, expirationSeconds = 3600) {
  const now = Math.floor(Date.now() / 1000);
  return generateEthAuthProof(privateKey, {
    iat: now,
    exp: now + expirationSeconds
  });
}
