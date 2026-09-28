import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createHandlers, validateData } from '../api/_handlers.js';
import { createMemoryStore } from '../api/_store.js';
import { hashPassword, createSessionCookie } from '../api/_auth.js';
import { defaultData } from '../src/defaultData.js';

process.env.SESSION_SECRET = randomBytes(32).toString('hex');
const password = 'test-password-long';
const hash = await hashPassword(password);
const accounts = ['pm','contributor','viewer'].map(role => ({ id: role, username: role, name: role, role, active: true, revision: 1, passwordHash: hash }));
function fixture() {
  const data = structuredClone(defaultData);
  const item = data.phases[0].groups[0].items[0];
  item.assigneeId = 'contributor'; item.owner = 'contributor'; item.status = 'blocked';
  const store = createMemoryStore(accounts, data), handlers = createHandlers(store);
  const cookies = Object.fromEntries(accounts.map(u => [u.role, createSessionCookie(u).split(';')[0]]));
  async function call(route, method = 'GET', role, body, extraHeaders = {}) {
    const res = { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(n) { this.statusCode = n; return this; }, json(x) { this.body = x; return this; }, end() { return this; } };
    await handlers[route]({ method, headers: { host: 'localhost:4173', ...(role ? {cookie: cookies[role] || role} : {}), ...extraHeaders }, body }, res);
    return res;
  }
  const toggle = { version: 1, phaseId: data.phases[0].id, groupId: data.phases[0].groups[0].id, itemId: item.id, complete: true };
  return { data, store, call, toggle, cookies };
}
test('anonymous cannot read or write data or manage users', async () => {
  const {call} = fixture();
  for (const [route,method] of [['data','GET'],['data','PUT'],['data','PATCH'],['users','GET'],['users','POST'],['users','DELETE'],['history','GET']]) assert.equal((await call(route,method)).statusCode,401);
});
test('individual login rejects wrong passwords and never exposes hash', async () => {
  const {call} = fixture();
  assert.equal((await call('session','POST',null,{username:'contributor',password:'wrong'})).statusCode,401);
  const login = await call('session','POST',null,{username:'Contributor',password});
  assert.equal(login.body.user.role,'contributor');
  assert.equal(login.body.user.passwordHash,undefined);
  assert.match(login.headers['Set-Cookie'],/HttpOnly; Secure; SameSite=Lax/);
});
test('all roles read without incrementing document version', async () => {
  const {call,store} = fixture();
  for (const role of ['pm','contributor','viewer']) assert.equal((await call('data','GET',role)).body.version,1);
  assert.equal((await store.read()).version,1);
});
test('viewer and contributor cannot PUT a forged whole document', async () => {
  const {call,data,store} = fixture();
  data.project.name = 'unauthorized';
  for (const role of ['viewer','contributor']) assert.equal((await call('data','PUT',role,{data,version:1})).statusCode,403);
  assert.notEqual((await store.read()).data.project.name,'unauthorized');
});
test('viewer cannot tick; contributor can only tick assigned task', async () => {
  const {call,toggle,data} = fixture();
  assert.equal((await call('data','PATCH','viewer',toggle)).statusCode,403);
  assert.equal((await call('data','PATCH','contributor',{...toggle,itemId:data.phases[0].groups[0].items[1].id})).statusCode,403);
  const result = await call('data','PATCH','contributor',toggle);
  assert.equal(result.statusCode,200); assert.equal(result.body.data.phases[0].groups[0].items[0].status,'done');
});
test('unchecking restores prior blocked status', async () => {
  const {call,toggle} = fixture();
  await call('data','PATCH','contributor',toggle);
  const result = await call('data','PATCH','contributor',{...toggle,version:2,complete:false});
  assert.equal(result.body.data.phases[0].groups[0].items[0].status,'blocked');
});
test('completion history records trusted actor and reopening; only PM can read it', async () => {
  const {call,toggle} = fixture();
  await call('data','PATCH','contributor',toggle);
  await call('data','PATCH','contributor',{...toggle,version:2,complete:false});
  for (const role of ['viewer','contributor']) assert.equal((await call('history','GET',role)).statusCode,403);
  const result = await call('history','GET','pm');
  assert.equal(result.statusCode,200);
  assert.deepEqual(result.body.history.map(x => x.action),['reopened','completed']);
  assert.equal(result.body.history[0].userId,'contributor');
  assert.equal(result.body.history[0].userName,'contributor');
  assert.equal(result.body.history[0].taskTitle,'Understand Founder Vision');
  assert.ok(Number.isFinite(Date.parse(result.body.history[0].eventAt)));
});
test('PM changing status in task editor also creates history', async () => {
  const {call,data} = fixture();
  data.phases[0].groups[0].items[0].status = 'done';
  assert.equal((await call('data','PUT','pm',{data,version:1})).statusCode,200);
  const result = await call('history','GET','pm');
  assert.equal(result.body.history.length,1);
  assert.equal(result.body.history[0].action,'completed');
  assert.equal(result.body.history[0].username,'pm');
});
test('PATCH rejects hidden field edits and leaves document untouched', async () => {
  const {call,toggle,store} = fixture();
  assert.equal((await call('data','PATCH','contributor',{...toggle,owner:'attacker'})).statusCode,400);
  assert.equal((await store.read()).version,1);
});
test('assigned contributor updates only status, notes and document fields', async () => {
  const {call,toggle,data,store} = fixture();
  const body = { version: 1, phaseId: toggle.phaseId, groupId: toggle.groupId, itemId: toggle.itemId, status: 'progress', notes: 'Updated note', documentName: 'Design file', documentUrl: 'https://example.com/design' };
  const result = await call('data','PATCH','contributor',body);
  assert.equal(result.statusCode,200);
  const item = result.body.data.phases[0].groups[0].items[0];
  assert.equal(item.title,'Understand Founder Vision');
  assert.equal(item.owner,'contributor');
  assert.equal(item.status,'progress');
  assert.equal(item.notes,'Updated note');
  assert.equal(item.documentName,'Design file');
  assert.equal(item.documentUrl,'https://example.com/design');
  assert.equal((await call('data','PATCH','contributor',{...body,version:2,title:'Forged title'})).statusCode,400);
  assert.equal((await store.read()).data.phases[0].groups[0].items[0].title,'Understand Founder Vision');
  assert.equal((await call('data','PATCH','contributor',{...body,version:2,itemId:data.phases[0].groups[0].items[1].id})).statusCode,403);
});
test('contributor task detail rejects incomplete or unsafe document links', async () => {
  const {call,toggle} = fixture();
  const body = { version: 1, phaseId: toggle.phaseId, groupId: toggle.groupId, itemId: toggle.itemId, status: 'todo', notes: '', documentName: 'Brief', documentUrl: '' };
  assert.equal((await call('data','PATCH','contributor',body)).statusCode,400);
  assert.equal((await call('data','PATCH','contributor',{...body,documentUrl:'javascript:alert(1)'})).statusCode,400);
});
test('PM edits valid data; invalid assignment or duplicate IDs rejected', async () => {
  const {call,data} = fixture();
  assert.equal(validateData(data,accounts),true);
  data.phases[0].groups[0].items[0].assigneeId = 'viewer';
  assert.equal((await call('data','PUT','pm',{data,version:1})).statusCode,400);
  data.phases[0].groups[0].items[0].assigneeId = 'contributor';
  data.project.name = 'Updated';
  assert.equal((await call('data','PUT','pm',{data,version:1})).body.data.project.name,'Updated');
  data.phases[1].id = data.phases[0].id;
  assert.equal((await call('data','PUT','pm',{data,version:2})).statusCode,400);
});
test('task documents accept paired http links and reject unsafe or incomplete values', async () => {
  const {data} = fixture();
  const item = data.phases[0].groups[0].items[0];
  assert.equal(validateData(data, accounts), true);
  item.documentName = 'Product brief'; item.documentUrl = 'https://docs.example.com/brief';
  assert.equal(validateData(data, accounts), true);
  item.documentUrl = 'javascript:alert(1)';
  assert.equal(validateData(data, accounts), false);
  item.documentUrl = ''; assert.equal(validateData(data, accounts), false);
});
test('stale and simultaneous writes cannot overwrite a newer version', async () => {
  const {call,toggle,store} = fixture();
  const results = await Promise.all([call('data','PATCH','contributor',toggle),call('data','PATCH','pm',toggle)]);
  assert.deepEqual(results.map(r => r.statusCode).sort(),[200,409]);
  assert.equal((await store.read()).version,2);
});
test('only PM creates accounts, duplicate usernames are case insensitive', async () => {
  const {call,store} = fixture();
  const body = {username:'new.person',name:'New Person',password,role:'contributor'};
  for (const role of ['viewer','contributor']) assert.equal((await call('users','POST',role,body)).statusCode,403);
  const result = await call('users','POST','pm',body);
  assert.equal(result.statusCode,201); assert.equal(result.body.user.passwordHash,undefined);
  assert.equal((await call('users','POST','pm',{...body,username:'NEW.PERSON'})).statusCode,409);
  assert.notEqual((await store.userByName('new.person')).passwordHash,password);
  assert.equal((await call('session','POST',null,{username:'new.person',password})).statusCode,200);
});
test('deactivating account invalidates sessions and prevents login', async () => {
  const {call,toggle} = fixture();
  assert.equal((await call('users','PATCH','pm',{id:'contributor',active:false})).statusCode,200);
  assert.equal((await call('data','PATCH','contributor',toggle)).statusCode,401);
  assert.equal((await call('session','POST',null,{username:'contributor',password})).statusCode,401);
  await call('users','PATCH','pm',{id:'contributor',active:true});
  assert.equal((await call('data','GET','contributor')).statusCode,401);
});
test('PM accounts cannot be disabled', async () => {
  const {call} = fixture(); assert.equal((await call('users','PATCH','pm',{id:'pm',active:false})).statusCode,403);
});
test('PM changes member roles, cannot change self, and viewer assignments are unlinked', async () => {
  const {call,cookies} = fixture();
  assert.equal((await call('users','PATCH','contributor',{id:'viewer',role:'contributor'})).statusCode,403);
  assert.equal((await call('users','PATCH','pm',{id:'pm',role:'viewer'})).statusCode,403);
  const promoted = await call('users','PATCH','pm',{id:'viewer',role:'contributor'});
  assert.equal(promoted.statusCode,200); assert.equal(promoted.body.user.role,'contributor');
  const changed = await call('users','PATCH','pm',{id:'contributor',role:'viewer'});
  assert.equal(changed.statusCode,200); assert.equal(changed.body.user.role,'viewer');
  assert.equal(changed.body.state.version,3);
  const item = changed.body.state.data.phases[0].groups[0].items[0];
  assert.equal(item.assigneeId,undefined); assert.equal(item.owner,'contributor');
  assert.equal((await call('data','GET',cookies.contributor)).statusCode,401);
});
test('only PM deletes non-PM accounts and assigned tasks are safely unlinked', async () => {
  const {call,store} = fixture();
  assert.equal((await call('users','DELETE','viewer',{id:'contributor'})).statusCode,403);
  assert.equal((await call('users','DELETE','pm',{id:'pm'})).statusCode,403);
  const result = await call('users','DELETE','pm',{id:'contributor'});
  assert.equal(result.statusCode,200);
  assert.equal(result.body.userId,'contributor');
  assert.equal(result.body.state.version,2);
  const item = result.body.state.data.phases[0].groups[0].items[0];
  assert.equal(item.assigneeId,undefined);
  assert.equal(item.owner,'contributor');
  assert.equal(await store.userById('contributor'),undefined);
  assert.equal((await call('session','POST',null,{username:'contributor',password})).statusCode,401);
});
test('tampered cookie and shared legacy passcode cannot authenticate', async () => {
  const {call,cookies} = fixture();
  assert.equal((await call('data','GET',cookies.pm+'x')).statusCode,401);
  assert.equal((await call('session','POST',null,{password:'local-demo'})).statusCode,401);
});
test('logout revokes issued cookie, cross-origin writes fail', async () => {
  const {call,toggle} = fixture();
  assert.equal((await call('data','PATCH','contributor',toggle,{origin:'https://other.example'})).statusCode,403);
  await call('session','DELETE','contributor');
  assert.equal((await call('data','GET','contributor')).statusCode,401);
});
