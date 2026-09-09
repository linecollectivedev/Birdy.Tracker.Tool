import { useEffect, useRef, useState } from 'react';
import { CircularProgressbar, buildStyles } from 'react-circular-progressbar';
import 'react-circular-progressbar/dist/styles.css';

const statuses = { todo: 'To do', progress: 'In progress', done: 'Done', blocked: 'Blocked' };
const roles = { pm: 'Project Manager', contributor: 'Contributor', viewer: 'Viewer / Client' };
const colors = ['#ffb32c','#4dbdf5','#a78bfa','#f472b6','#fb7185','#34d399','#22d3ee','#f59e0b','#94a3b8'];
const uid = () => crypto.randomUUID();
const itemsOf = p => p.groups.flatMap(g => g.items);
const percentage = items => items.length ? Math.round(items.filter(i => i.status === 'done').length / items.length * 100) : 0;
const dateLabel = due => due ? new Date(due + 'T00:00:00').toLocaleDateString('vi-VN') : '—';
async function api(path, method = 'GET', body) {
  const response = await fetch('/api/' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.error || 'Không thể thực hiện thao tác'), { status: response.status });
  return result;
}

export function App() {
  const [user, setUser] = useState(null), [checking, setChecking] = useState(true);
  const [snapshot, setSnapshot] = useState(null), [members, setMembers] = useState([]);
  const [history, setHistory] = useState([]);
  const [phaseId, setPhaseId] = useState(''), [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false), [exporting, setExporting] = useState(false), [error, setError] = useState(''), [sync, setSync] = useState('');
  const locked = useRef(false), reportRef = useRef(null);
  const isPM = user?.role === 'pm';
  useEffect(() => { api('session').then(x => setUser(x.user)).catch(e => setError(e.message)).finally(() => setChecking(false)); }, []);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    setSnapshot(null); setError(''); setSync('Đang tải…');
    Promise.all([api('data'), user.role === 'pm' ? api('users') : Promise.resolve({ users: [] })])
      .then(([state, people]) => { if (!cancelled) { setSnapshot(state); setMembers(people.users); setSync('Dữ liệu đã tải'); } })
      .catch(e => { if (!cancelled) { setError(e.message); if (e.status === 401) setUser(null); } });
    return () => { cancelled = true; };
  }, [user]);

  async function write(path, method, body, accept) {
    if (locked.current) return false;
    locked.current = true; setBusy(true); setError(''); setSync('Đang lưu…');
    try { const result = await api(path, method, body); accept(result); setSync('Đã lưu'); return true; }
    catch (e) { setError(e.message); setSync('Chưa lưu được'); if (e.status === 401) { setUser(null); setDialog(null); } return false; }
    finally { locked.current = false; setBusy(false); }
  }
  async function saveData(next) { return write('data', 'PUT', { data: next, version: snapshot.version }, setSnapshot); }
  async function logout() {
    if (busy) return;
    try { await api('session', 'DELETE'); setUser(null); setSnapshot(null); setDialog(null); setError(''); setPhaseId(''); }
    catch (e) { setError(e.message); }
  }
  async function openHistory() {
    if (busy) return;
    setBusy(true); setError('');
    try { setHistory((await api('history')).history); setDialog({ type: 'history' }); }
    catch (e) { setError(e.message); if (e.status === 401) setUser(null); }
    finally { setBusy(false); }
  }
  async function downloadReport() {
    if (exporting || !reportRef.current) return;
    setExporting(true); setError('');
    try {
      await document.fonts?.ready;
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([import('html2canvas'), import('jspdf')]);
      const sheets = [...reportRef.current.querySelectorAll('.pdf-sheet')];
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
      for (let index = 0; index < sheets.length; index++) {
        if (index) pdf.addPage();
        const canvas = await html2canvas(sheets[index], { scale: 2, backgroundColor: '#ffffff', logging: false, useCORS: true });
        pdf.addImage(canvas.toDataURL('image/jpeg', .92), 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      }
      const stamp = new Date().toLocaleDateString('en-CA');
      const projectName = data.project.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '') || 'Project';
      pdf.save(`${projectName}-Report-${stamp}.pdf`);
      setSync('Đã tải report PDF');
    } catch {
      setError('Không thể tạo report PDF. Vui lòng thử lại.');
    } finally { setExporting(false); }
  }
  if (checking) return <Gate><p>Đang kiểm tra đăng nhập…</p></Gate>;
  if (!user) return <Login onSuccess={u => { setError(''); setUser(u); }} initialError={error}/>;
  if (!snapshot) return <Gate><p>{error || 'Đang tải project…'}</p><button onClick={() => location.reload()}>Thử lại</button><button onClick={logout}>Đăng xuất</button></Gate>;

  const data = snapshot.data;
  const phase = data.phases.find(p => p.id === phaseId) || data.phases[0];
  const allItems = data.phases.flatMap(itemsOf);
  const patchPhase = (next, fn) => { next.phases = next.phases.map(p => p.id === phase.id ? fn(p) : p); };
  async function toggle(groupId, item) {
    await write('data', 'PATCH', { phaseId: phase.id, groupId, itemId: item.id, complete: item.status !== 'done', version: snapshot.version }, setSnapshot);
  }
  async function saveEditor(payload) {
    const next = structuredClone(data);
    if (dialog.type === 'phase') next.phases.push({ ...payload, id: uid(), symbol: String(next.phases.length + 1), color: colors[next.phases.length % colors.length], groups: [] });
    if (dialog.type === 'editPhase') patchPhase(next, p => ({ ...p, ...payload }));
    if (dialog.type === 'group') patchPhase(next, p => ({ ...p, groups: [...p.groups, { ...payload, id: uid(), items: [] }] }));
    if (dialog.type === 'editGroup') patchPhase(next, p => ({ ...p, groups: p.groups.map(g => g.id === dialog.target.id ? { ...g, ...payload } : g) }));
    if (['item','editItem'].includes(dialog.type)) patchPhase(next, p => ({ ...p, groups: p.groups.map(g => g.id !== dialog.groupId ? g : { ...g, items: dialog.type === 'item' ? [...g.items, { ...payload, id: uid() }] : g.items.map(i => i.id === dialog.target.id ? { ...i, ...payload } : i) }) }));
    if (await saveData(next)) setDialog(null);
  }
  async function remove(type, groupId, itemId) {
    if (!confirm(type === 'group' ? 'Xóa nhóm này và tất cả task trong nhóm?' : 'Xóa task này?')) return;
    const next = structuredClone(data);
    patchPhase(next, p => ({ ...p, groups: type === 'group' ? p.groups.filter(g => g.id !== groupId) : p.groups.map(g => g.id === groupId ? { ...g, items: g.items.filter(i => i.id !== itemId) } : g) }));
    await saveData(next);
  }
  const close = () => { if (!busy) { setDialog(null); setError(''); } };
  return <div className="tracker">
    <header className="topbar"><div className="identity"><span className="mark">B</span><div><h1>{data.project.name}</h1><p>{data.project.subtitle}</p></div></div>
      <div className="file-actions"><div className="account-badge"><strong>{user.name}</strong><span>{roles[user.role]}</span></div>
        <button disabled={busy || exporting} onClick={downloadReport}>{exporting ? 'Đang tạo PDF…' : 'Tải PDF'}</button>
        {isPM && <><button disabled={busy} onClick={openHistory}>Lịch sử</button><button disabled={busy} onClick={() => setDialog({ type: 'members' })}>Thành viên</button><button disabled={busy} onClick={() => setDialog({ type: 'control' })}>Control panel</button><button disabled={busy} className="accent" onClick={() => setDialog({ type: 'phase' })}>+ Phase</button></>}
        <button disabled={busy} onClick={logout}>Đăng xuất</button>
      </div>
    </header>
    <nav className="phase-nav" aria-label="Project phases">{data.phases.map((p, index) => <button key={p.id} style={{ '--phase-color': p.color || colors[index % colors.length] }} className={p.id === phase?.id ? 'active' : ''} onClick={() => setPhaseId(p.id)}><span>{p.symbol || index + 1}</span><b>{p.name}</b><small>{percentage(itemsOf(p))}%</small></button>)}</nav>
    <div className="access-note">{isPM ? 'Quản lý phase, nhóm công việc và task của dự án.' : user.role === 'contributor' ? 'Bạn có thể xem tất cả task và tick hoàn thành task được giao cho mình.' : 'Chế độ chỉ xem · Bạn có thể xem task và tiến độ dự án.'}</div>
    {error && !dialog && <div className="page-error" role="alert">{error} <button onClick={() => location.reload()}>Tải dữ liệu mới nhất</button></div>}
    <main className="workspace"><aside className="overview"><ProgressPanel phases={data.phases}/><Breakdown items={allItems}/></aside><section className="work-area">
      <section className="phase-intro"><div><p>PHASE {data.phases.indexOf(phase) + 1} OF {data.phases.length}</p><h2>{phase?.name}</h2><span>{phase?.description}</span>{phase?.notes && <small className="content-note">{phase.notes}</small>}</div>
        {isPM && <div className="phase-actions"><button disabled={busy} onClick={() => setDialog({ type: 'editPhase', target: phase })}>Edit phase</button><button disabled={busy} onClick={() => setDialog({ type: 'group' })}>+ Add group of work</button></div>}
      </section>
      {!phase?.groups.length ? <section className="empty"><b>Chưa có nhóm công việc</b>{isPM && <button onClick={() => setDialog({ type: 'group' })}>+ Add group of work</button>}</section> : <div className="groups">{phase.groups.map(group => <Group key={group.id} group={group} user={user} busy={busy}
        onAdd={() => setDialog({ type: 'item', groupId: group.id })}
        onEdit={item => setDialog({ type: isPM ? 'editItem' : 'viewItem', target: item, groupId: group.id })}
        onEditGroup={() => setDialog({ type: 'editGroup', target: group })}
        onRemove={() => remove('group', group.id)} onRemoveItem={id => remove('item', group.id, id)} onToggle={item => toggle(group.id, item)}/>)}</div>}
    </section></main>
    <footer><span className={`sync ${busy ? 'saving' : error ? 'error' : 'saved'}`} role="status">{sync}</span></footer>
    <ReportDocument reportRef={reportRef} data={data} user={user}/>
    {dialog?.type === 'history' ? <History entries={history} onClose={close}/> :
      dialog?.type === 'members' ? <Members members={members} busy={busy} error={error} onClose={close} onCreate={async form => write('users', 'POST', form, x => setMembers(m => [...m, x.user]))} onActive={async member => write('users', 'PATCH', { id: member.id, active: !member.active }, x => setMembers(m => m.map(u => u.id === x.user.id ? x.user : u)))}/> :
      dialog?.type === 'control' ? <ControlPanel data={data} busy={busy} error={error} onClose={close} onSave={async next => { if (await saveData(next)) close(); }}/> :
      dialog?.type === 'viewItem' ? <ItemDetails item={dialog.target} onClose={close}/> :
      dialog ? <Editor key={`${dialog.type}-${dialog.target?.id || 'new'}`} dialog={dialog} members={members} busy={busy} error={error} onClose={close} onSave={saveEditor}/> : null}
  </div>;
}

function ReportDocument({ reportRef, data, user }) {
  const allItems = data.phases.flatMap(itemsOf);
  const totals = {
    todo: allItems.filter(item => item.status === 'todo').length,
    progress: allItems.filter(item => item.status === 'progress').length,
    done: allItems.filter(item => item.status === 'done').length,
    blocked: allItems.filter(item => item.status === 'blocked').length,
  };
  const pages = reportPages(data.phases);
  const generatedAt = new Date().toLocaleString('vi-VN', { dateStyle: 'long', timeStyle: 'short' });
  return <div className="pdf-report-root" ref={reportRef} aria-hidden="true">
    <section className="pdf-sheet pdf-cover">
      <ReportHeader data={data}/>
      <div className="pdf-title-block"><span>PROJECT PROGRESS REPORT</span><h1>{data.project.name}</h1><p>{data.project.subtitle}</p></div>
      <div className="pdf-overall"><div><strong>{percentage(allItems)}%</strong><span>Overall progress</span></div><p>Báo cáo tổng quan tiến độ và danh sách công việc hiện tại của dự án.</p></div>
      <div className="pdf-summary-grid">
        {[['Total tasks', allItems.length, 'neutral'], ['Done', totals.done, 'done'], ['In progress', totals.progress, 'progress'], ['Blocked', totals.blocked, 'blocked'], ['To do', totals.todo, 'todo']].map(([label, value, tone]) => <div className={tone} key={label}><strong>{value}</strong><span>{label}</span></div>)}
      </div>
      <div className="pdf-section-heading"><h2>Progress by phase</h2><span>{data.phases.length} phases</span></div>
      <div className="pdf-phase-list">{data.phases.map((phase, index) => { const value = percentage(itemsOf(phase)); return <div key={phase.id}><span className="pdf-phase-number">{phase.symbol || index + 1}</span><b>{phase.name}</b><div className="pdf-progress"><i style={{ width: `${value}%`, background: phase.color || colors[index % colors.length] }}/></div><strong>{value}%</strong></div>; })}</div>
      <ReportFooter page={1} total={pages.length + 1} generatedAt={generatedAt} user={user}/>
    </section>
    {pages.map(({ phase, phaseIndex, groups, part }, index) => <section className="pdf-sheet pdf-detail" key={`${phase.id}-${part}`}>
      <ReportHeader data={data}/>
      <div className="pdf-detail-title"><span>PHASE {phaseIndex + 1} OF {data.phases.length}{part > 1 ? ` · PART ${part}` : ''}</span><h2>{phase.name}</h2><p>{phase.description}</p></div>
      {groups.length ? groups.map(({ group, items, continued }) => <div className="pdf-group-block" key={`${group.id}-${continued ? items[0]?.id : 'start'}`}>
        <div className="pdf-group-heading"><div><span>GROUP OF WORK{continued ? ' · CONTINUED' : ''}</span><h3>{group.name}</h3>{!continued && group.description && <p>{group.description}</p>}</div><strong>{group.items.filter(item => item.status === 'done').length}/{group.items.length}<small>DONE</small></strong></div>
        <div className="pdf-task-table"><div className="pdf-task-head"><span/><span>Task</span><span>Owner</span><span>Due</span><span>Status</span></div>
          {items.map(item => <div className="pdf-task-row" key={item.id}><span className={`pdf-check ${item.status === 'done' ? 'checked' : ''}`}>{item.status === 'done' ? '✓' : ''}</span><div><b>{item.title}</b>{item.notes && <small>{item.notes}</small>}</div><span>{item.owner || 'Chưa assign'}</span><span>{dateLabel(item.due)}</span><span><i className={`pdf-status ${item.status}`}>{statuses[item.status]}</i></span></div>)}
        </div>
      </div>) : <div className="pdf-empty">Phase này chưa có nhóm công việc hoặc task.</div>}
      <ReportFooter page={index + 2} total={pages.length + 1} generatedAt={generatedAt} user={user}/>
    </section>)}
  </div>;
}
function reportPages(phases) {
  const maxUnits = 28;
  return phases.flatMap((phase, phaseIndex) => {
    if (!phase.groups.length) return [{ phase, phaseIndex, groups: [], part: 1 }];
    const pages = []; let groups = [], used = 0, part = 1;
    const flush = () => { if (groups.length) pages.push({ phase, phaseIndex, groups, part: part++ }); groups = []; used = 0; };
    for (const group of phase.groups) {
      if (!group.items.length) {
        if (used + 2 > maxUnits) flush();
        groups.push({ group, items: [], continued: false }); used += 2; continue;
      }
      const wholeGroupUnits = group.items.length + 2;
      if (wholeGroupUnits <= maxUnits && used && used + wholeGroupUnits > maxUnits) flush();
      let offset = 0;
      while (offset < group.items.length) {
        if (used + 3 > maxUnits) flush();
        const take = Math.min(group.items.length - offset, maxUnits - used - 2);
        groups.push({ group, items: group.items.slice(offset, offset + take), continued: offset > 0 });
        used += take + 2; offset += take;
        if (offset < group.items.length) flush();
      }
    }
    flush(); return pages;
  });
}
function ReportHeader({ data }) { return <header className="pdf-header"><span className="pdf-mark">B</span><div><strong>{data.project.name}</strong><small>LINE COLLECTIVE · PROJECT TRACKER</small></div><span>CONFIDENTIAL</span></header>; }
function ReportFooter({ page, total, generatedAt, user }) { return <footer className="pdf-footer"><span>Generated {generatedAt} · {user.name}</span><strong>{page} / {total}</strong></footer>; }

function Gate({ children }) { return <main className="gate"><div className="gate-card"><span className="mark">B</span><h1>Project Tracker</h1>{children}</div></main>; }
function Login({ onSuccess, initialError }) {
  const [username, setUsername] = useState(''), [password, setPassword] = useState(''), [error, setError] = useState(initialError), [busy, setBusy] = useState(false);
  async function submit(e) { e.preventDefault(); setBusy(true); setError(''); try { onSuccess((await api('session', 'POST', { username, password })).user); } catch (e) { setError(e.message); } finally { setBusy(false); } }
  return <main className="gate"><form className="gate-card" onSubmit={submit}><span className="mark">B</span><p className="eyebrow">LINE COLLECTIVE</p><h1>Project Tracker</h1><p>Đăng nhập bằng tài khoản được PM cấp.</p>
    <label>Tên đăng nhập<input autoFocus required autoComplete="username" maxLength={40} value={username} onChange={e => setUsername(e.target.value)} placeholder="Tên đăng nhập"/></label>
    <label>Mật khẩu<input required autoComplete="current-password" type="password" maxLength={128} value={password} onChange={e => setPassword(e.target.value)} placeholder="Mật khẩu"/></label>
    {error && <div className="login-error" role="alert">{error}</div>}<button className="accent" disabled={busy || !username || !password}>{busy ? 'Đang đăng nhập…' : 'Đăng nhập'}</button>
  </form></main>;
}
function ProgressPanel({ phases }) { const overall = percentage(phases.flatMap(itemsOf)); return <section className="overview-card progress-card"><h3>OVERALL PROGRESS</h3><div className="donut"><CircularProgressbar value={overall} styles={buildStyles({ pathColor: '#0071e3', trailColor: '#ededf0', strokeLinecap: 'butt' })}/><div><strong>{overall}%</strong><span>COMPLETE</span></div></div><div className="phase-progress">{phases.map((p, index) => <div className="phase-meter" key={p.id}><p><span>{p.name}</span><b>{percentage(itemsOf(p))}%</b></p><progress max="100" value={percentage(itemsOf(p))} style={{ '--meter': p.color || colors[index % colors.length] }}/></div>)}</div></section>; }
function Breakdown({ items }) { return <section className="overview-card breakdown"><h3>TASK BREAKDOWN</h3><div>{[['Total tasks',items.length,''],['Done',items.filter(i => i.status === 'done').length,'green'],['In progress',items.filter(i => i.status === 'progress').length,'blue'],['Blocked',items.filter(i => i.status === 'blocked').length,'red']].map(([label,n,tone]) => <div key={label}><strong className={tone}>{n}</strong><span>{label}</span></div>)}</div></section>; }
function Group({ group, user, busy, onAdd, onEdit, onEditGroup, onRemove, onRemoveItem, onToggle }) {
  const pm = user.role === 'pm';
  return <article className="group-card"><header><div><p>GROUP OF WORK</p><h3>{group.name}</h3><span>{group.description}</span>{group.notes && <small className="content-note">{group.notes}</small>}</div><div><b>{group.items.filter(i => i.status === 'done').length}/{group.items.length}</b>{pm && <div className="group-actions"><button disabled={busy} onClick={onEditGroup}>Edit group</button><button disabled={busy} onClick={onRemove}>Delete group</button></div>}</div></header>
    <div className="group-head"><span>Item</span><span>Owner</span><span>Due</span><span>Status</span><span/></div>
    {group.items.map(item => { const canTick = pm || (user.role === 'contributor' && item.assigneeId === user.id); return <div className="item-row" key={item.id}>
      {canTick ? <button role="checkbox" aria-checked={item.status === 'done'} disabled={busy} className={`check ${item.status === 'done' ? 'checked' : ''}`} aria-label={`Hoàn thành: ${item.title}`} onClick={() => onToggle(item)}>{item.status === 'done' ? '✓' : ''}</button> : <div className={`check readonly-check ${item.status === 'done' ? 'checked' : ''}`} aria-label={item.status === 'done' ? 'Đã hoàn thành' : 'Chưa hoàn thành'}>{item.status === 'done' ? '✓' : ''}</div>}
      <button className="item-title" onClick={() => onEdit(item)}>{item.title}{item.notes && <small>{item.notes}</small>}<small className="mobile-task-meta">{item.owner || 'Chưa assign'} · {dateLabel(item.due)}</small></button>
      <span>{item.owner || '—'}</span><span>{dateLabel(item.due)}</span><span><i className={`status ${item.status}`}>{statuses[item.status]}</i></span>{pm && <button disabled={busy} className="more" aria-label={`Xóa task: ${item.title}`} onClick={() => onRemoveItem(item.id)}>×</button>}
    </div>; })}{pm && <button disabled={busy} className="add-item" onClick={onAdd}>+ Add item</button>}
  </article>;
}
function Modal({ title, children, onClose, busy = false, error, onSubmit, wide = false }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current?.querySelector('input, textarea, select, button')?.focus();
    return () => previous?.focus();
  }, []);
  function keys(e) {
    if (e.key === 'Escape' && !busy) { e.preventDefault(); onClose(); }
    if (e.key === 'Tab') {
      const fields = [...ref.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled)')];
      const first = fields[0], last = fields.at(-1);
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
    }
  }
  return <div className="overlay"><form ref={ref} className={`editor ${wide ? 'control-panel' : ''}`} role="dialog" aria-modal="true" aria-label={title} onKeyDown={keys} onSubmit={e => { e.preventDefault(); if (!busy) onSubmit?.(); }}>
    <header><div><p>PROJECT TRACKER</p><h2>{title}</h2></div><button type="button" disabled={busy} aria-label="Đóng" onClick={onClose}>×</button></header>
    {children}{error && <p className="login-error" role="alert">{error}</p>}
    {onSubmit && <footer><button type="button" disabled={busy} onClick={onClose}>Cancel</button><button className="accent" disabled={busy} type="submit">{busy ? 'Đang lưu…' : 'Save'}</button></footer>}
  </form></div>;
}
function Editor({ dialog, members, busy, error, onClose, onSave }) {
  const target = dialog.target || {};
  const content = ['phase','editPhase','group','editGroup'].includes(dialog.type);
  const [form, setForm] = useState({ name: target.name || '', description: target.description || '', title: target.title || '', owner: target.owner || '', assigneeId: target.assigneeId || '', status: target.status || 'todo', due: target.due || '', notes: target.notes || '' });
  const field = (key, value) => setForm(f => ({ ...f, [key]: value }));
  const title = { phase: 'New phase', editPhase: 'Edit phase', group: 'New group of work', editGroup: 'Edit group', item: 'New item', editItem: 'Edit item' }[dialog.type];
  function submit() {
    if (content) onSave({ name: form.name.trim(), description: form.description.trim(), notes: form.notes.trim() });
    else onSave({ title: form.title.trim(), owner: form.owner, assigneeId: form.assigneeId, status: form.status, due: form.due, notes: form.notes.trim(), previousStatus: form.status !== target.status ? 'todo' : target.previousStatus || 'todo' });
  }
  return <Modal title={title} busy={busy} error={error} onClose={onClose} onSubmit={submit}>
    <fieldset disabled={busy} className="form-fields">{content ? <><label>Name<input required maxLength={200} value={form.name} onChange={e => field('name', e.target.value)}/></label><label>Description<textarea maxLength={5000} value={form.description} onChange={e => field('description', e.target.value)}/></label></> : <>
      <label>Item name<input required maxLength={500} value={form.title} onChange={e => field('title', e.target.value)}/></label>
      <div className="form-grid"><label>Người phụ trách<select value={form.assigneeId} onChange={e => { const id = e.target.value; setForm(f => ({ ...f, assigneeId: id, owner: members.find(u => u.id === id)?.name || '' })); }}>
        <option value="">{!form.assigneeId && form.owner ? `${form.owner} (chưa liên kết tài khoản)` : 'Chưa assign'}</option>
        {members.filter(u => u.role !== 'viewer' && (u.active || u.id === form.assigneeId)).map(u => <option key={u.id} value={u.id}>{u.name} (@{u.username}){u.active ? '' : ' · đã khóa'}</option>)}
      </select></label><label>Status<select value={form.status} onChange={e => field('status', e.target.value)}>{Object.entries(statuses).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label><label>Due date<input type="date" value={form.due} onChange={e => field('due', e.target.value)}/></label></div>
      {!form.assigneeId && form.owner && <p className="field-hint">Chọn tài khoản để người phụ trách có quyền tick task này.</p>}
    </>}
    <label>Notes<textarea maxLength={5000} value={form.notes} onChange={e => field('notes', e.target.value)}/></label></fieldset>
  </Modal>;
}
function ItemDetails({ item, onClose }) { return <Modal title={item.title} onClose={onClose}><dl className="task-details"><dt>Người phụ trách</dt><dd>{item.owner || 'Chưa assign'}</dd><dt>Deadline</dt><dd>{dateLabel(item.due)}</dd><dt>Status</dt><dd>{statuses[item.status]}</dd><dt>Notes</dt><dd>{item.notes || 'Chưa có ghi chú'}</dd></dl></Modal>; }
function History({ entries, onClose }) {
  const when = value => new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  return <Modal title="Lịch sử hoàn thành" wide onClose={onClose}>
    <p className="field-hint">Ghi nhận người thực hiện mỗi lần task được tick hoàn thành hoặc mở lại.</p>
    {!entries.length ? <div className="history-empty">Chưa có hoạt động hoàn thành task.</div> : <div className="history-list">{entries.map(entry => <article className="history-row" key={entry.id}>
      <span className={`history-action ${entry.action}`}>{entry.action === 'completed' ? 'Đã hoàn thành' : 'Đã mở lại'}</span>
      <div><strong>{entry.taskTitle}</strong><p>{entry.phaseName} · {entry.groupName}</p><small><b>{entry.userName}</b> (@{entry.username}) · {when(entry.eventAt)}</small></div>
    </article>)}</div>}
  </Modal>;
}
function ControlPanel({ data, busy, error, onClose, onSave }) {
  const [draft, setDraft] = useState(() => structuredClone(data));
  const field = (id, key, value) => setDraft(d => ({ ...d, phases: d.phases.map(p => p.id === id ? { ...p, [key]: value } : p) }));
  return <Modal title="Control panel" wide busy={busy} error={error} onClose={onClose} onSubmit={() => onSave(draft)}><fieldset disabled={busy} className="form-fields">
    <label>Project name<input required value={draft.project.name} onChange={e => setDraft(d => ({ ...d, project: { ...d.project, name: e.target.value } }))}/></label><label>Subtitle<input value={draft.project.subtitle} onChange={e => setDraft(d => ({ ...d, project: { ...d.project, subtitle: e.target.value } }))}/></label>
    <div className="control-head"><span>Color</span><span>Symbol</span><span>Phase name</span></div><div className="phase-controls">{draft.phases.map((p,index) => <div key={p.id}><input aria-label={`${p.name} color`} type="color" value={p.color || colors[index % colors.length]} onChange={e => field(p.id, 'color', e.target.value)}/><input aria-label={`${p.name} symbol`} maxLength={4} value={p.symbol || String(index + 1)} onChange={e => field(p.id, 'symbol', e.target.value)}/><input required aria-label={`${p.name} name`} value={p.name} onChange={e => field(p.id, 'name', e.target.value)}/></div>)}</div>
  </fieldset></Modal>;
}
function Members({ members, busy, error, onClose, onCreate, onActive }) {
  const empty = { name: '', username: '', password: '', role: 'contributor' };
  const [form, setForm] = useState(empty), [created, setCreated] = useState('');
  const field = (key, value) => setForm(f => ({ ...f, [key]: value }));
  return <Modal title="Thành viên" wide busy={busy} error={error} onClose={onClose} onSubmit={async () => { if (await onCreate(form)) { setCreated(`Đã tạo tài khoản @${form.username}`); setForm(empty); } }}>
    <div className="member-list">{members.map(u => <div className="member-row" key={u.id}><div><strong>{u.name}</strong><small>@{u.username} · {roles[u.role]}{u.active ? '' : ' · Đã khóa'}</small></div>{u.role !== 'pm' && <button disabled={busy} type="button" onClick={() => onActive(u)}>{u.active ? 'Khóa' : 'Mở khóa'}</button>}</div>)}</div>
    <h3>Tạo tài khoản</h3><p className="field-hint">Tài khoản mới được vào project này theo role đã chọn.</p>
    <fieldset disabled={busy} className="form-fields"><div className="form-grid"><label>Họ tên<input required maxLength={100} value={form.name} onChange={e => field('name', e.target.value)}/></label><label>Tên đăng nhập<input required pattern="[a-zA-Z0-9._\-]{3,40}" autoComplete="off" minLength={3} maxLength={40} value={form.username} onChange={e => field('username', e.target.value)}/></label></div>
      <label>Mật khẩu ban đầu<input required type="password" autoComplete="new-password" minLength={12} maxLength={128} placeholder="Ít nhất 12 ký tự" value={form.password} onChange={e => field('password', e.target.value)}/></label>
      <label>Role<select value={form.role} onChange={e => field('role', e.target.value)}>{Object.entries(roles).map(([v,label]) => <option key={v} value={v}>{label}</option>)}</select></label>
    </fieldset>{created && <p role="status">{created}</p>}
  </Modal>;
}

