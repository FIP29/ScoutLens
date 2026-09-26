// ---------------------------------------------------------------------
// Admin authentication.
//
// One fixed admin logs in with email + password (bcrypt-hashed in the
// `admins` table) and receives a JWT. The token travels in an httpOnly,
// SameSite=Strict cookie rather than an Authorization header:
//
//   httpOnly        - page JavaScript cannot read it, so an XSS bug cannot
//                     steal the admin session
//   SameSite=Strict - the browser will not attach it to a request that
//                     starts on another site, which is the CSRF defence
//   Path=/api/admin - it is only ever sent to the admin endpoints
//
// All secrets and tuning come from environment variables. If JWT_SECRET is
// missing or too short the admin routes answer 503 with an explanation,
// but the public app keeps working - a misconfigured admin should never
// take browsing down with it.
// ---------------------------------------------------------------------

import jwt from 'jsonwebtoken';
import { query } from '../db/pool.js';

export const COOKIE_NAME = 'scoutlens_admin';
const COOKIE_PATH = '/api/admin';
const ISSUER = 'scoutlens';
const AUDIENCE = 'scoutlens-admin';
const MIN_SECRET_LENGTH = 32;

/**
 * Reads auth settings from the environment on each call, so a changed
 * .env takes effect on restart without any module-level caching surprises.
 * Returns null when the configuration cannot be used safely.
 */
export function authConfig() {
  const secret = process.env.JWT_SECRET ?? '';
  if (secret.length < MIN_SECRET_LENGTH) return null;

  const rounds = Number(process.env.BCRYPT_ROUNDS ?? 12);
  return {
    secret,
    expiresIn: process.env.JWT_EXPIRES_IN || '2h',
    // Below 10 is too cheap to slow a brute force; above 15 makes each
    // login take seconds. Clamp rather than trust the value blindly.
    bcryptRounds: Number.isInteger(rounds) ? Math.min(Math.max(rounds, 10), 15) : 12,
    // Secure cookies need HTTPS. Local development runs on plain http, so
    // the flag is opt-in and on by default only in production.
    secureCookie: process.env.COOKIE_SECURE
      ? process.env.COOKIE_SECURE === 'true'
      : process.env.NODE_ENV === 'production',
  };
}

export const NOT_CONFIGURED_MESSAGE =
  `Admin login is not configured. Set JWT_SECRET (at least ${MIN_SECRET_LENGTH} characters) `
  + 'in the project .env and restart the server. See README > Admin access.';

/** Issues a token for the admin and sets it as the session cookie. */
export function issueSession(res, admin, config) {
  const token = jwt.sign(
    { sub: String(admin.id), email: admin.email },
    config.secret,
    { algorithm: 'HS256', expiresIn: config.expiresIn, issuer: ISSUER, audience: AUDIENCE },
  );

  // Match the cookie lifetime to the token's own expiry, read back from
  // the token so the two can never drift apart.
  const { exp } = jwt.decode(token);
  const expiresAt = new Date(exp * 1000);

  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config.secureCookie,
    path: COOKIE_PATH,
    expires: expiresAt,
  });
  return expiresAt;
}

export function clearSession(res, config) {
  res.clearCookie(COOKIE_NAME, {
    httpOnly: true,
    sameSite: 'strict',
    secure: config?.secureCookie ?? false,
    path: COOKIE_PATH,
  });
}

/**
 * Middleware guarding every admin write. Rejects the request unless it
 * carries a valid, unexpired token for an admin that still exists.
 */
export async function requireAdmin(req, res, next) {
  const config = authConfig();
  if (!config) return res.status(503).json({ error: NOT_CONFIGURED_MESSAGE });

  const token = req.cookies?.[COOKIE_NAME];
  if (!token) return res.status(401).json({ error: 'Admin login required.' });

  let claims;
  try {
    // Pin the algorithm: accepting whatever the token's header claims is
    // the classic JWT pitfall ("alg": "none", or HMAC/RSA confusion).
    claims = jwt.verify(token, config.secret, {
      algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE,
    });
  } catch (err) {
    clearSession(res, config);
    const message = err.name === 'TokenExpiredError'
      ? 'Your admin session has expired. Please log in again.'
      : 'Invalid admin session. Please log in again.';
    return res.status(401).json({ error: message });
  }

  try {
    // Cheap for a single admin, and it means deleting the admin row locks
    // out any token still in circulation.
    const [admin] = await query('SELECT id, email FROM admins WHERE id = ?', [Number(claims.sub)]);
    if (!admin) {
      clearSession(res, config);
      return res.status(401).json({ error: 'Admin account no longer exists.' });
    }
    req.admin = admin;
    return next();
  } catch (err) {
    return next(err);
  }
}
