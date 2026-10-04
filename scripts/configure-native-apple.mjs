#!/usr/bin/env node
// Private key and generated JWT never enter argv, logs, source files, or the client.
import { createPrivateKey, createPublicKey, sign, verify } from 'node:crypto'
import { readFile, stat } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'

export function createNativeClientSecret({ pem, teamID, keyID, bundleID, now = Math.floor(Date.now() / 1000), days = 90 }) {
  if (!/^[A-Z0-9]{10}$/.test(teamID) || !/^[A-Z0-9]{10}$/.test(keyID)) throw new Error('Invalid team or key ID')
  if (!/^[A-Za-z0-9]+(?:\.[A-Za-z0-9-]+)+$/.test(bundleID)) throw new Error('Invalid native bundle ID')
  if (!Number.isInteger(now) || now <= 0 || !Number.isInteger(days) || days < 1 || days > 180) throw new Error('Invalid JWT lifetime')
  const key = createPrivateKey(pem)
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') throw new Error('Expected Apple P-256 key')
  const header = { alg: 'ES256', kid: keyID }
  const claims = { iss: teamID, iat: now, exp: now + days * 86400, aud: 'https://appleid.apple.com', sub: bundleID }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  const message = `${encode(header)}.${encode(claims)}`
  const signature = sign('sha256', Buffer.from(message), { key, dsaEncoding: 'ieee-p1363' })
  if (!verify('sha256', Buffer.from(message), { key: createPublicKey(key), dsaEncoding: 'ieee-p1363' }, signature)) throw new Error('Signature self-check failed')
  return { token: `${message}.${signature.toString('base64url')}`, claims, header }
}

function convex(args, input) {
  const result = spawnSync('npx', ['--no-install', 'convex', ...args], { input, encoding: 'utf8', timeout: 60000 })
  // Do not forward stdout/stderr: env get outputs secrets, errors can echo input.
  if (result.error || result.status !== 0) throw new Error(`Convex ${args[1]} failed; no credential values logged`)
  return result.stdout.trim()
}

async function main() {
  const options = Object.fromEntries(process.argv.slice(2).filter(arg => arg.startsWith('--') && arg.includes('=')).map(arg => arg.slice(2).split(/=(.*)/s).slice(0, 2)))
  const { deployment, key: keyPath, team: teamID, kid: keyID, bundle: bundleID } = options
  if (!deployment || !keyPath || !teamID || !keyID || !bundleID) throw new Error('Required: --deployment=NAME --key=PATH --team=ID --kid=ID --bundle=ID; add --apply to configure, --rotate to replace an existing JWT')
  const file = await stat(keyPath)
  if (!file.isFile() || (file.mode & 0o077) !== 0) throw new Error('Private key must be an owner-only file')
  const { token, claims, header } = createNativeClientSecret({ pem: await readFile(keyPath), teamID, keyID, bundleID })
  const selector = ['--deployment', deployment]
  if (convex(['env', 'get', 'APPLE_BUNDLE_ID', ...selector]) !== bundleID) throw new Error('Deployment bundle ID does not match')
  if (!convex(['env', 'get', 'BETTER_AUTH_SECRET', ...selector])) throw new Error('Deployment encryption secret is missing; it was not changed')
  const existing = convex(['env', 'get', 'APPLE_NATIVE_CLIENT_SECRET', ...selector])
  const apply = process.argv.includes('--apply')
  const rotate = process.argv.includes('--rotate')
  if (existing && !rotate) throw new Error('Credential already exists; explicit --rotate required')
  if (apply) {
    if (rotate) {
      // Rotation touches only the native JWT, never the encryption or web secret.
      convex(['env', 'set', 'APPLE_NATIVE_CLIENT_SECRET', ...selector], token)
    } else {
      // Bulk mode refuses differing existing values (including concurrent edits).
      convex(['env', 'set', ...selector], `APPLE_BUNDLE_ID=${bundleID}\nAPPLE_NATIVE_CLIENT_SECRET=${token}\n`)
    }
    if (convex(['env', 'get', 'APPLE_NATIVE_CLIENT_SECRET', ...selector]) !== token) throw new Error('Credential readback did not match')
  }
  console.log(JSON.stringify({ deployment, applied: apply, bundleID, teamID, keyID: header.kid, expiresAt: new Date(claims.exp * 1000).toISOString(), rotationRequired: true }))
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
