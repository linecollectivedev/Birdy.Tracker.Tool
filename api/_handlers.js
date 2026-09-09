import { randomUUID } from 'node:crypto';
import { createDatabaseStore } from './_store.js';
import { getUser, publicUser, hashPassword, verifyPassword, roles, createSessionCookie, clearSessionCookie } from './_auth.js';

export function validateData(data, users) {
  if (!data?.project || typeof data.project.name !== 'string' || !data.project.name.trim() || typeof data.project.subtitle !== 'string' || !Array.isArray(data.phases) || !data.phases.length || data.phases.length > 100) return false;
  const ids = new Set();
  const entity = x => x && typeof x.id === 'string' && x.id.length <= 100 && x.id.length > 0 && !ids.has(x.id) && (ids.add(x.id), true);
  const text = (s, limit = 5000) => typeof s === 'string' && s.length <= limit;
  for (const p of data.phases) {
    if (!entity(p) || !text(p.name, 200) || !p.name.trim() || !Array.isArray(p.groups) || p.groups.length > 200) return false;
    for (const g of p.groups) {
      if (!entity(g) || !text(g.name, 200) || !g.name.trim() || !Array.isArray(g.items) || g.items.length > 2000) return false;
      for (const i of g.items) {
        if (!entity(i) || !text(i.title, 500) || !i.title.trim() || !['todo','progress','done','blocked'].includes(i.status) || !text(i.notes ?? '') || !text(i.owner ?? '', 200)) return false;
        if (i.assigneeId && !users.some(u => u.id === i.assigneeId && u.role !== 'viewer')) return false;
        if (i.due && (typeof i.due !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(i.due) || !Number.isFinite(Date.parse(i.due)))) return false;
      }
    }
  }
  return true;
}
export function createHandlers(store) {
  const itemMap = data => new Map(data.phases.flatMap(phase => phase.groups.flatMap(group => group.items.map(item => [item.id, { phase, group, item }]))));
  const historyEvents = (before, after, user) => {
    const oldItems = itemMap(before);
    return [...itemMap(after)].flatMap(([id, current]) => {
      const previous = oldItems.get(id);
      if (!previous || (previous.item.status === 'done') === (current.item.status === 'done')) return [];
      return [{
        id: randomUUID(), userId: user.id, userName: user.name, username: user.username,
        action: current.item.status === 'done' ? 'completed' : 'reopened',
        taskId: id, taskTitle: current.item.title,
        phaseId: current.phase.id, phaseName: current.phase.name,
        groupId: current.group.id, groupName: current.group.name,
        eventAt: new Date().toISOString(),
      }];
    });
  };
  async function session(req, res) {
    if (req.method === 'GET') { const user = await getUser(req, store); return res.json({ authenticated: !!user, user: user ? publicUser(user) : null }); }
    if (req.method === 'POST') {
      const { username, password } = req.body || {};
      if (typeof username !== 'string' || typeof password !== 'string' || password.length > 128 || username.length > 40) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu chưa đúng' });
      const user = await store.userByName(username.trim().toLowerCase());
      const fallback = '00000000000000000000000000000000:' + '0'.repeat(128);
      const valid = await verifyPassword(password, user?.passwordHash || fallback);
      if (!valid || !user?.active) return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu chưa đúng' });
      res.setHeader('Set-Cookie', createSessionCookie(user));
      return res.json({ authenticated: true, user: publicUser(user) });
    }
    if (req.method === 'DELETE') {
      const user = await getUser(req, store);
      if (user) await store.revoke(user.id);
      res.setHeader('Set-Cookie', clearSessionCookie());
      return res.json({ authenticated: false });
    }
    return res.status(405).end();
  }
  async function users(req, res, user) {
    if (user.role !== 'pm') return res.status(403).json({ error: 'Chỉ Project Manager được quản lý tài khoản' });
    if (req.method === 'GET') return res.json({ users: (await store.users()).map(publicUser) });
    if (req.method === 'POST') {
      const { name, username, password, role } = req.body || {};
      if (typeof name !== 'string' || !name.trim() || name.length > 100 || typeof username !== 'string' || !/^[a-zA-Z0-9._-]{3,40}$/.test(username) || typeof password !== 'string' || password.length < 12 || password.length > 128 || !roles.includes(role)) return res.status(400).json({ error: 'Nhập tên, username 3–40 ký tự và mật khẩu 12–128 ký tự; chọn role hợp lệ.' });
      const account = { id: randomUUID(), username: username.toLowerCase(), name: name.trim(), role, active: true, revision: 1, passwordHash: await hashPassword(password) };
      if (!await store.addUser(account)) return res.status(409).json({ error: 'Tên đăng nhập đã tồn tại' });
      return res.status(201).json({ user: publicUser(account) });
    }
    if (req.method === 'PATCH') {
      const { id, active } = req.body || {};
      const target = typeof id === 'string' ? await store.userById(id) : null;
      if (!target || typeof active !== 'boolean') return res.status(400).json({ error: 'Tài khoản không hợp lệ' });
      // PM accounts cannot be disabled here, preventing removal of the last PM.
      if (target.role === 'pm') return res.status(403).json({ error: 'Không thể khóa tài khoản Project Manager tại đây' });
      return res.json({ user: publicUser(await store.setActive(id, active)) });
    }
    return res.status(405).end();
  }
  async function data(req, res, user) {
    if (req.method === 'GET') return res.json(await store.read());
    if (req.method !== 'PUT' && req.method !== 'PATCH') return res.status(405).end();
    if (user.role === 'viewer' || (req.method === 'PUT' && user.role !== 'pm')) return res.status(403).json({ error: 'Bạn không có quyền chỉnh sửa dữ liệu này' });
    const body = req.body || {};
    if (!Number.isInteger(body.version)) return res.status(400).json({ error: 'Version không hợp lệ' });
    const current = await store.read();
    if (current.version !== body.version) return res.status(409).json({ error: 'Có cập nhật mới. Tải lại dữ liệu trước khi sửa tiếp.', ...current });
    let next;
    if (req.method === 'PUT') {
      if (!validateData(body.data, await store.users())) return res.status(400).json({ error: 'Dữ liệu hoặc người được assign không hợp lệ' });
      next = body.data;
    } else {
      if (Object.keys(body).some(k => !['version','phaseId','groupId','itemId','complete'].includes(k)) || typeof body.complete !== 'boolean') return res.status(400).json({ error: 'Chỉ được cập nhật tick hoàn thành' });
      next = structuredClone(current.data);
      const item = next.phases.find(p => p.id === body.phaseId)?.groups.find(g => g.id === body.groupId)?.items.find(i => i.id === body.itemId);
      if (!item) return res.status(404).json({ error: 'Task không tồn tại' });
      if (user.role !== 'pm' && item.assigneeId !== user.id) return res.status(403).json({ error: 'Bạn chỉ được tick task được giao cho mình' });
      if (body.complete && item.status !== 'done') { item.previousStatus = item.status; item.status = 'done'; }
      if (!body.complete && item.status === 'done') { item.status = ['todo','progress','blocked'].includes(item.previousStatus) ? item.previousStatus : 'todo'; delete item.previousStatus; }
    }
    const saved = await store.save(next, current.version, historyEvents(current.data, next, user));
    return saved ? res.json(saved) : res.status(409).json({ error: 'Có cập nhật mới. Tải lại dữ liệu trước khi sửa tiếp.', ...await store.read() });
  }
  async function history(req, res, user) {
    if (user.role !== 'pm') return res.status(403).json({ error: 'Chỉ Project Manager được xem lịch sử hoàn thành' });
    if (req.method !== 'GET') return res.status(405).end();
    return res.json({ history: await store.history() });
  }
  return Object.fromEntries(Object.entries({ session, users, data, history }).map(([name, handler]) => [name, async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    try {
      if (!['GET','HEAD'].includes(req.method)) {
        const origin = req.headers.origin;
        if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && new URL(origin).host !== req.headers.host)) return res.status(403).json({ error: 'Nguồn yêu cầu không hợp lệ' });
      }
      await store.init();
      const user = name === 'session' ? null : await getUser(req, store);
      if (name !== 'session' && !user) return res.status(401).json({ error: 'Vui lòng đăng nhập' });
      return await handler(req, res, user);
    } catch { return res.status(503).json({ error: 'Dịch vụ chưa sẵn sàng. Kiểm tra cấu hình server hoặc thử lại.' }); }
  }]));
}
let production;
export const productionHandler = name => async (req, res) => {
  try { production ||= createHandlers(createDatabaseStore()); return await production[name](req, res); }
  catch { return res.status(503).json({ error: 'Database chưa được cấu hình' }); }
};
