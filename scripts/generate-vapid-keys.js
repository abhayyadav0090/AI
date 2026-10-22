#!/usr/bin/env node
// Generate VAPID keys for Web Push without adding a runtime dependency.
const crypto = require('node:crypto');
const ecdh = crypto.createECDH('prime256v1');
ecdh.generateKeys();
const b64url = (value) => Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
console.log('Add these as environment variables to your hosting service. Keep the private key secret.\n');
console.log(`VAPID_PUBLIC_KEY=${b64url(ecdh.getPublicKey(null, 'uncompressed'))}`);
console.log(`VAPID_PRIVATE_KEY=${b64url(ecdh.getPrivateKey())}`);
console.log('VAPID_SUBJECT=mailto:your-contact-email@example.com');
