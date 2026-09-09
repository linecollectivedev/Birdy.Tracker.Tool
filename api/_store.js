import { neon } from '@neondatabase/serverless';
import { defaultData } from '../src/defaultData.js';
import { hashPassword } from './_auth.js';

export async function bootstrapUser() {
  const username = process.env.BOOTSTRAP_PM_USERNAME?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PM_PASSWORD;
  if (!username || !password) return null;
  if (!/^[a-z0-9._-]{3,40}$/.test(username) || password.length < 12 || password.length > 128) throw new Error('Cấu hình tài khoản PM chưa hợp lệ');
  return { id: 'bootstrap-pm', username, name: 'Project Manager', role: 'pm', active: true, revision: 1, passwordHash: await hashPassword(password) };
}
export function createMemoryStore(users = [], data = defaultData) {
  const accounts = structuredClone(users);
  let state = { data: structuredClone(data), version: 1 };
  const history = [];
  return {
    init: async () => {},
    users: async () => structuredClone(accounts),
    userById: async id => structuredClone(accounts.find(u => u.id === id)),
    userByName: async name => structuredClone(accounts.find(u => u.username === name)),
    addUser: async user => { if (accounts.some(u => u.username === user.username)) return false; accounts.push(structuredClone(user)); return true; },
    setActive: async (id, active) => { const user = accounts.find(u => u.id === id); if (!user) return null; user.active = active; user.revision++; return structuredClone(user); },
    revoke: async id => { const user = accounts.find(u => u.id === id); if (user) user.revision++; },
    read: async () => structuredClone(state),
    history: async () => structuredClone(history.slice().reverse()),
    save: async (data, version, events = []) => {
      if (state.version !== version) return null;
      state = { data: structuredClone(data), version: version + 1 };
      history.push(...structuredClone(events));
      return structuredClone(state);
    },
  };
}
export function createDatabaseStore() {
  if (!process.env.DATABASE_URL) throw new Error('Database chưa được kết nối');
  const sql = neon(process.env.DATABASE_URL);
  let ready;
  return {
    init() { return ready ||= (async () => {
      await sql`CREATE TABLE IF NOT EXISTS tracker_users (id TEXT PRIMARY KEY, username TEXT UNIQUE NOT NULL, name TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('pm','contributor','viewer')), active BOOLEAN NOT NULL DEFAULT TRUE, revision INTEGER NOT NULL DEFAULT 1, password_hash TEXT NOT NULL)`;
      await sql`CREATE TABLE IF NOT EXISTS tracker_state (id TEXT PRIMARY KEY, data JSONB NOT NULL, version INTEGER NOT NULL DEFAULT 1, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
      await sql`CREATE TABLE IF NOT EXISTS tracker_task_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        user_name TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL CHECK (action IN ('completed','reopened')),
        task_id TEXT NOT NULL,
        task_title TEXT NOT NULL,
        phase_id TEXT NOT NULL,
        phase_name TEXT NOT NULL,
        group_id TEXT NOT NULL,
        group_name TEXT NOT NULL,
        event_at TIMESTAMPTZ NOT NULL
      )`;
      await sql`CREATE INDEX IF NOT EXISTS tracker_task_history_event_at_idx ON tracker_task_history (event_at DESC)`;
      const existing = await sql`SELECT id FROM tracker_users LIMIT 1`;
      if (!existing.length) {
        const user = await bootstrapUser();
        if (user) await sql`INSERT INTO tracker_users (id,username,name,role,password_hash) VALUES (${user.id},${user.username},${user.name},'pm',${user.passwordHash}) ON CONFLICT DO NOTHING`;
      }
      await sql`INSERT INTO tracker_state (id,data) VALUES ('birdy-main',${JSON.stringify(defaultData)}::jsonb) ON CONFLICT DO NOTHING`;
    })().catch(error => { ready = null; throw error; }); },
    users: async () => sql`SELECT id,username,name,role,active,revision FROM tracker_users ORDER BY name`,
    userById: async id => (await sql`SELECT *, password_hash AS "passwordHash" FROM tracker_users WHERE id=${id}`)[0],
    userByName: async name => (await sql`SELECT *, password_hash AS "passwordHash" FROM tracker_users WHERE username=${name}`)[0],
    addUser: async u => (await sql`INSERT INTO tracker_users (id,username,name,role,password_hash) VALUES (${u.id},${u.username},${u.name},${u.role},${u.passwordHash}) ON CONFLICT (username) DO NOTHING RETURNING id`).length > 0,
    setActive: async (id, active) => (await sql`UPDATE tracker_users SET active=${active},revision=revision+1 WHERE id=${id} RETURNING *`)[0],
    revoke: async id => { await sql`UPDATE tracker_users SET revision=revision+1 WHERE id=${id}`; },
    read: async () => (await sql`SELECT data,version FROM tracker_state WHERE id='birdy-main'`)[0],
    history: async () => sql`SELECT id,user_id AS "userId",user_name AS "userName",username,action,task_id AS "taskId",task_title AS "taskTitle",phase_id AS "phaseId",phase_name AS "phaseName",group_id AS "groupId",group_name AS "groupName",event_at AS "eventAt" FROM tracker_task_history ORDER BY event_at DESC LIMIT 200`,
    save: async (data, version, events = []) => (await sql`
      WITH updated AS (
        UPDATE tracker_state SET data=${JSON.stringify(data)}::jsonb,version=version+1,updated_at=NOW()
        WHERE id='birdy-main' AND version=${version} RETURNING data,version
      ), inserted AS (
        INSERT INTO tracker_task_history (id,user_id,user_name,username,action,task_id,task_title,phase_id,phase_name,group_id,group_name,event_at)
        SELECT e.id,e."userId",e."userName",e.username,e.action,e."taskId",e."taskTitle",e."phaseId",e."phaseName",e."groupId",e."groupName",e."eventAt"::timestamptz
        FROM updated, jsonb_to_recordset(${JSON.stringify(events)}::jsonb) AS e(id text,"userId" text,"userName" text,username text,action text,"taskId" text,"taskTitle" text,"phaseId" text,"phaseName" text,"groupId" text,"groupName" text,"eventAt" text)
      )
      SELECT data,version FROM updated
    `)[0],
  };
}
