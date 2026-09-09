import crypto from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(crypto.scrypt);
const COOKIE = 'lc_session';
export const roles = ['pm', 'contributor', 'viewer'];
export const publicUser = ({ id, username, name, role, active }) => ({ id, username, name, role, active });
export const safeEqual = (a, b) => {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
};
export async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  return `${salt}:${(await scrypt(password, salt, 64)).toString('hex')}`;
}
export async function verifyPassword(password, hash) {
  const [salt, expected] = hash.split(':');
  return safeEqual((await scrypt(password, salt, 64)).toString('hex'), expected);
}
function sign(value) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) throw new Error('SESSION_SECRET phải có ít nhất 32 ký tự');
  return crypto.createHmac('sha256', process.env.SESSION_SECRET).update(value).digest('hex');
}
export function createSessionCookie(user) {
  const value = Buffer.from(JSON.stringify({ uid: user.id, revision: user.revision, expires: Date.now() + 14 * 86400000 })).toString('base64url');
  return `${COOKIE}=${value}.${sign(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=1209600`;
}
export function clearSessionCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`; }
export async function getUser(req, store) {
  const token = (req.headers.cookie || '').split(';').map(x => x.trim()).find(x => x.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  if (!token) return null;
  try {
    const [value, signature, extra] = token.split('.');
    if (extra || !signature || !safeEqual(sign(value), signature)) return null;
    const claims = JSON.parse(Buffer.from(value, 'base64url').toString());
    if (!Number.isFinite(claims.expires) || claims.expires <= Date.now()) return null;
    const user = await store.userById(claims.uid);
    return user?.active && roles.includes(user.role) && user.revision === claims.revision ? user : null;
  } catch { return null; }
}
