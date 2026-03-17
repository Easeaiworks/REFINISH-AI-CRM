const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cron = require('node-cron');
const { initDatabase, queryAll, queryOne, execute } = require('./src/db/init');
const { runGDriveImport } = require('./src/gdrive-import');

const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || 'refinish-ai-dev-secret-change-in-production';

// ─── Auth helpers ───
function generateToken(payload) {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '24h' });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.cookies?.token;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch { return res.status(401).json({ error: 'Invalid or expired token' }); }
}

async function logAudit(req, entityType, entityId, action, changes = {}) {
  try {
    await execute('INSERT INTO audit_log (user_id, entity_type, entity_id, action, changes, ip_address) VALUES ($1, $2, $3, $4, $5, $6)',
      [req.user?.userId || null, entityType, entityId, action, JSON.stringify(changes), req.ip || 'unknown']);
  } catch (e) { console.error('Audit error:', e.message); }
}

// ─── Duplicate detection ───
function levenshtein(a, b) {
  const m = []; const al = a.length; const bl = b.length;
  if (!al) return bl; if (!bl) return al;
  for (let i = 0; i <= bl; i++) m[i] = [i];
  for (let j = 0; j <= al; j++) m[0][j] = j;
  for (let i = 1; i <= bl; i++)
    for (let j = 1; j <= al; j++)
      m[i][j] = b[i-1] === a[j-1] ? m[i-1][j-1] : Math.min(m[i-1][j-1]+1, m[i][j-1]+1, m[i-1][j]+1);
  return m[bl][al];
}

function similarity(a, b) {
  const al = a.toLowerCase().trim(); const bl = b.toLowerCase().trim();
  if (al === bl) return 1; const max = Math.max(al.length, bl.length);
  return max === 0 ? 1 : 1 - levenshtein(al, bl) / max;
}

async function findDuplicates(shopName, city, threshold = 0.85, excludeId) {
  let sql = 'SELECT * FROM accounts WHERE deleted_at IS NULL';
  const params = [];
  if (excludeId) { sql += ' AND id != $1'; params.push(excludeId); }
  const all = await queryAll(sql, params);
  const matches = [];
  for (const a of all) {
    let score = similarity(shopName, a.shop_name);
    if (city && a.city && similarity(city, a.city) > 0.8) score = Math.min(score + 0.05, 1);
    if (score >= threshold) matches.push({ account: a, score });
  }
  return matches.sort((a, b) => b.score - a.score);
}

async function autoSeed() {
  const count = await queryOne('SELECT COUNT(*) as count FROM users');
  if (!count || parseInt(count.count) === 0) {
    console.log('Empty database detected — running auto-seed...');
    const seedData = require('./src/db/seed-data.json');

    const adminHash = await bcrypt.hash('admin123', 12);
    const repHash = await bcrypt.hash('rep123', 12);

    await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['adam@chcpaint.com', adminHash, 'Adam', 'Berube', 'admin']);
    const { lastId: michelleId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['michelle@chcpaint.com', repHash, 'Michelle', 'Rep', 'rep']);
    const { lastId: benId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
      ['ben@chcpaint.com', repHash, 'Ben', 'Halliday', 'rep']);

    let total = 0;
    for (const row of (seedData['Michelles Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,former_sherwin_client,tags) VALUES ($1,$2,$3,$4,$5,$6)',
        [row['Shop Name'], row['City/Area']||null, michelleId, 'prospect', row['Former Sherwin Client? Y/N']==='Y', '[]']);
      if (row['Notes']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, michelleId, '[Imported] '+row['Notes']]);
      total++;
    }
    for (const row of (seedData['Bens Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'], row['City/Area']||null, benId, 'prospect', '[]']);
      total++;
    }
    for (const row of (seedData['Joint Accounts'] || [])) {
      if (!row['Shop Name']) continue;
      await execute('INSERT INTO accounts (shop_name,address,city,contact_names,suppliers,paint_line,sundries,has_contract,mpo,num_techs,sq_footage,status,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
        [row['Shop Name'],row['Address']||null,row['City/Area']||null,row['Contact(s)']||null,row['Supplier(s)']||null,row['Paint']||null,row['Sundries']||null,row['Contract? Y/N']==='Y',row['MPO']||null,row['# of Techs']?parseInt(row['# of Techs']):null,row['Shop Sq. Footage']||null,'active','[]']);
      total++;
    }
    for (const row of (seedData['Cold'] || [])) {
      if (!row['Shop Name']) continue;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,address,city,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'],row['Address']||null,row['City']||null,'cold','[]']);
      if (row['Reason']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, benId, '[Cold - Reason] '+row['Reason']]);
      total++;
    }
    for (const row of (seedData['DNC Request'] || [])) {
      if (!row['Shop Name']) continue;
      const rep = (row['Rep Pursuing']||'').toLowerCase().includes('michelle') ? michelleId : benId;
      const { lastId } = await execute('INSERT INTO accounts (shop_name,city,assigned_rep_id,status,tags) VALUES ($1,$2,$3,$4,$5)', [row['Shop Name'],row['City/Area']||null,rep,'dnc','[]']);
      if (row['Notes']) await execute('INSERT INTO notes (account_id,created_by_id,content) VALUES ($1,$2,$3)', [lastId, rep, '[DNC - Reason] '+row['Notes']]);
      total++;
    }
    console.log(`Auto-seed complete: 3 users, ${total} accounts imported`);
  }
}

async function startServer() {
  await initDatabase();
  await autoSeed();
  const app = express();

  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(compression());
  const corsOrigin = process.env.NODE_ENV === 'production'
    ? (process.env.CORS_ORIGIN || true)
    : 'http://localhost:5173';
  app.use(cors({ origin: corsOrigin, credentials: true }));
  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));

  const authLimiter = rateLimit({ windowMs: 15*60*1000, max: 20, message: { error: 'Too many attempts' } });
  app.use('/api/auth/login', authLimiter);

  // ─── AUTH ROUTES ───
  app.post('/api/auth/register', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required to create users' });
      const { email, password, first_name, last_name, role } = req.body;
      if (!email || !password || !first_name || !last_name) return res.status(400).json({ error: 'All fields required' });
      if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      if (await queryOne('SELECT id FROM users WHERE email = $1', [email])) return res.status(409).json({ error: 'Email already exists' });
      const validRole = ['rep', 'manager', 'admin'].includes(role) ? role : 'rep';
      const hash = await bcrypt.hash(password, 12);
      const { lastId } = await execute('INSERT INTO users (email, password_hash, first_name, last_name, role) VALUES ($1,$2,$3,$4,$5)',
        [email, hash, first_name, last_name, validRole]);
      await logAudit(req, 'user', lastId, 'create', { email, role: validRole, created_by: req.user.email });
      res.status(201).json({ user: { id: lastId, email, first_name, last_name, role: validRole } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/auth/login', async (req, res) => {
    try {
      const { email, password } = req.body;
      const user = await queryOne('SELECT * FROM users WHERE email = $1 AND is_active = true', [email]);
      if (!user || !(await bcrypt.compare(password, user.password_hash)))
        return res.status(401).json({ error: 'Invalid credentials' });
      await execute('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
      await logAudit(req, 'user', user.id, 'login', {});
      res.json({ token: generateToken({ userId: user.id, email: user.email, role: user.role }),
        user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, role: user.role } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/auth/me', authenticate, async (req, res) => {
    const u = await queryOne('SELECT id,email,first_name,last_name,role FROM users WHERE id=$1', [req.user.userId]);
    res.json({ user: u });
  });

  app.get('/api/auth/users', authenticate, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'manager') {
      return res.status(403).json({ error: 'Admin or manager access required' });
    }
    res.json({ users: await queryAll('SELECT id,email,first_name,last_name,role,is_active,last_login,created_at FROM users ORDER BY first_name') });
  });

  // ─── ADMIN: Reset user password ───
  app.put('/api/auth/users/:id/reset-password', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { password } = req.body;
      if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
      const target = await queryOne('SELECT id, email, first_name, last_name FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const hash = await bcrypt.hash(password, 12);
      await execute('UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [hash, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: 'password_reset', target_email: target.email });
      res.json({ message: `Password reset for ${target.first_name} ${target.last_name}` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Revoke / restore user access ───
  app.put('/api/auth/users/:id/toggle-active', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot deactivate yourself' });
      const target = await queryOne('SELECT id, email, first_name, last_name, is_active FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const newStatus = !target.is_active;
      await execute('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [newStatus, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: newStatus ? 'restore_access' : 'revoke_access', target_email: target.email });
      res.json({ message: `${target.first_name} ${target.last_name} is now ${newStatus ? 'active' : 'deactivated'}`, is_active: newStatus });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Change user role ───
  app.put('/api/auth/users/:id/role', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { role } = req.body;
      if (!['rep', 'manager', 'admin'].includes(role)) return res.status(400).json({ error: 'Invalid role. Must be rep, manager, or admin' });
      if (parseInt(req.params.id) === req.user.userId) return res.status(400).json({ error: 'Cannot change your own role' });
      const target = await queryOne('SELECT id, email, first_name, last_name, role FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      await execute('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, req.params.id]);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', { action: 'role_change', from: target.role, to: role, target_email: target.email });
      res.json({ message: `${target.first_name} ${target.last_name} role changed to ${role}`, role });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ADMIN: Update user details ───
  app.put('/api/auth/users/:id', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const { first_name, last_name, email } = req.body;
      const target = await queryOne('SELECT * FROM users WHERE id=$1', [req.params.id]);
      if (!target) return res.status(404).json({ error: 'User not found' });
      const updates = ['updated_at = NOW()']; const params = []; let idx = 1;
      const changes = {};
      if (first_name) { updates.push(`first_name = $${idx++}`); params.push(first_name); changes.first_name = { from: target.first_name, to: first_name }; }
      if (last_name) { updates.push(`last_name = $${idx++}`); params.push(last_name); changes.last_name = { from: target.last_name, to: last_name }; }
      if (email) {
        const existing = await queryOne('SELECT id FROM users WHERE email = $1 AND id != $2', [email, req.params.id]);
        if (existing) return res.status(409).json({ error: 'Email already in use' });
        updates.push(`email = $${idx++}`); params.push(email); changes.email = { from: target.email, to: email };
      }
      params.push(req.params.id);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);
      await logAudit(req, 'user', parseInt(req.params.id), 'update', changes);
      const updated = await queryOne('SELECT id,email,first_name,last_name,role,is_active,last_login,created_at FROM users WHERE id=$1', [req.params.id]);
      res.json({ user: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ACCOUNTS ROUTES ───
  app.get('/api/accounts', authenticate, async (req, res) => {
    try {
      const { status, assigned_rep_id, city, search, category, branch, page = '1', limit = '50' } = req.query;
      const pg = parseInt(page); const lim = parseInt(limit); const off = (pg-1)*lim;
      let where = ['a.deleted_at IS NULL']; let params = []; let idx = 1;
      if (category) { where.push(`a.account_category = $${idx++}`); params.push(category); }
      if (branch) { where.push(`a.branch ILIKE $${idx++}`); params.push(`%${branch}%`); }
      if (status) { where.push(`a.status = $${idx++}`); params.push(status); }
      if (assigned_rep_id) { where.push(`a.assigned_rep_id = $${idx++}`); params.push(assigned_rep_id); }
      if (city) { where.push(`a.city ILIKE $${idx++}`); params.push(`%${city}%`); }
      if (search) {
        where.push(`(a.shop_name ILIKE $${idx} OR a.contact_names ILIKE $${idx+1} OR a.city ILIKE $${idx+2} OR a.email ILIKE $${idx+3} OR a.phone ILIKE $${idx+4})`);
        const s = `%${search}%`; params.push(s,s,s,s,s); idx += 5;
      }
      const w = 'WHERE ' + where.join(' AND ');
      const total = await queryOne(`SELECT COUNT(*) as total FROM accounts a ${w}`, params);
      const accounts = await queryAll(
        `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id ${w} ORDER BY a.shop_name LIMIT $${idx++} OFFSET $${idx++}`,
        [...params, lim, off]);
      res.json({ accounts, pagination: { page: pg, limit: lim, total: parseInt(total?.total) || 0, totalPages: Math.ceil((parseInt(total?.total)||0)/lim) } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/accounts/export/csv', authenticate, async (req, res) => {
    const accounts = await queryAll('SELECT a.*, u.first_name as rfn, u.last_name as rln FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL ORDER BY a.shop_name');
    const hdr = 'Shop Name,City,Contact,Phone,Email,Status,Rep\n';
    const rows = accounts.map(a => `"${a.shop_name}","${a.city||''}","${a.contact_names||''}","${a.phone||''}","${a.email||''}","${a.status}","${a.rfn||''} ${a.rln||''}"`).join('\n');
    res.setHeader('Content-Type','text/csv'); res.setHeader('Content-Disposition','attachment; filename=accounts.csv');
    res.send(hdr + rows);
  });

  app.get('/api/accounts/:id', authenticate, async (req, res) => {
    try {
      const account = await queryOne('SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.id=$1 AND a.deleted_at IS NULL', [req.params.id]);
      if (!account) return res.status(404).json({ error: 'Not found' });
      const notes = await queryAll('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.account_id=$1 ORDER BY n.created_at DESC', [req.params.id]);
      const activities = await queryAll('SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id=u.id WHERE act.account_id=$1 ORDER BY act.created_at DESC LIMIT 20', [req.params.id]);
      res.json({ account, notes, activities });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/accounts/check-duplicate', authenticate, async (req, res) => {
    const dupes = await findDuplicates(req.body.shop_name, req.body.city, 0.80, req.body.exclude_id);
    res.json({ hasDuplicates: dupes.length > 0, duplicates: dupes.map(d => ({
      id: d.account.id, shop_name: d.account.shop_name, city: d.account.city, status: d.account.status, score: d.score
    }))});
  });

  app.post('/api/accounts', authenticate, async (req, res) => {
    try {
      const b = req.body;
      if (!b.shop_name) return res.status(400).json({ error: 'shop_name required' });
      if (!b.skip_duplicate_check) {
        const dupes = await findDuplicates(b.shop_name, b.city);
        if (dupes.length > 0) return res.status(409).json({ error: 'Potential duplicate', duplicates: dupes.map(d => ({
          id: d.account.id, shop_name: d.account.shop_name, city: d.account.city, status: d.account.status, score: d.score }))});
      }
      const { lastId } = await execute(
        `INSERT INTO accounts (shop_name,address,city,area,province,contact_names,phone,email,account_type,assigned_rep_id,status,suppliers,paint_line,allied_products,sundries,has_contract,mpo,num_techs,sq_footage,annual_revenue,former_sherwin_client,follow_up_date,tags,account_category,branch,postal_code,phone2) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27)`,
        [b.shop_name,b.address||null,b.city||null,b.area||null,b.province||'ON',b.contact_names||null,b.phone||null,b.email||null,b.account_type||'collision',b.assigned_rep_id||null,b.status||'prospect',b.suppliers||null,b.paint_line||null,b.allied_products||null,b.sundries||null,b.has_contract?true:false,b.mpo||null,b.num_techs||null,b.sq_footage||null,b.annual_revenue||null,b.former_sherwin_client?true:false,b.follow_up_date||null,JSON.stringify(b.tags||[]),b.account_category||'lead',b.branch||null,b.postal_code||null,b.phone2||null]);
      await logAudit(req, 'account', lastId, 'create', { shop_name: b.shop_name });
      res.status(201).json({ account: await queryOne('SELECT * FROM accounts WHERE id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/accounts/:id', authenticate, async (req, res) => {
    try {
      const existing = await queryOne('SELECT * FROM accounts WHERE id=$1 AND deleted_at IS NULL', [req.params.id]);
      if (!existing) return res.status(404).json({ error: 'Not found' });
      const fields = ['shop_name','address','city','area','province','contact_names','phone','email','account_type','assigned_rep_id','status','suppliers','paint_line','allied_products','sundries','has_contract','mpo','num_techs','sq_footage','annual_revenue','former_sherwin_client','follow_up_date','tags','account_category','branch','postal_code','phone2'];
      const updates = ['updated_at = NOW()']; const params = []; const changes = {};
      let idx = 1;
      for (const f of fields) {
        if (req.body[f] !== undefined) {
          let v = req.body[f];
          if (f === 'tags' && Array.isArray(v)) v = JSON.stringify(v);
          if (f === 'has_contract' || f === 'former_sherwin_client') v = v ? true : false;
          updates.push(`${f} = $${idx++}`); params.push(v); changes[f] = { from: existing[f], to: v };
        }
      }
      params.push(req.params.id);
      await execute(`UPDATE accounts SET ${updates.join(', ')} WHERE id = $${idx}`, params);
      await logAudit(req, 'account', parseInt(req.params.id), 'update', changes);
      res.json({ account: await queryOne('SELECT * FROM accounts WHERE id=$1', [req.params.id]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/accounts/:id', authenticate, async (req, res) => {
    await execute('UPDATE accounts SET deleted_at = NOW() WHERE id = $1', [req.params.id]);
    await logAudit(req, 'account', parseInt(req.params.id), 'delete', {});
    res.json({ message: 'Deleted' });
  });

  app.post('/api/accounts/import', authenticate, async (req, res) => {
    try {
      const { accounts: data, skip_duplicates } = req.body;
      if (!Array.isArray(data)) return res.status(400).json({ error: 'accounts array required' });
      let imported = 0, skipped = 0, dupesList = [];
      for (const r of data) {
        if (!r.shop_name) { skipped++; continue; }
        const dupes = await findDuplicates(r.shop_name, r.city, 0.85);
        if (dupes.length > 0 && !skip_duplicates) { dupesList.push({ shop_name: r.shop_name, matchedWith: dupes[0].account.shop_name }); skipped++; continue; }
        await execute('INSERT INTO accounts (shop_name,address,city,contact_names,phone,email,status,tags) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [r.shop_name,r.address||null,r.city||null,r.contact_names||null,r.phone||null,r.email||null,r.status||'prospect','[]']);
        imported++;
      }
      await logAudit(req, 'account', null, 'import', { imported, skipped });
      res.json({ imported, skipped, duplicates: dupesList, total: data.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── NOTES ROUTES ───
  app.get('/api/accounts/:id/notes', authenticate, async (req, res) => {
    res.json({ notes: await queryAll('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.account_id=$1 ORDER BY n.created_at DESC', [req.params.id]) });
  });

  app.post('/api/accounts/:id/notes', authenticate, async (req, res) => {
    try {
      if (!req.body.content?.trim()) return res.status(400).json({ error: 'Content required' });
      const { lastId } = await execute('INSERT INTO notes (account_id, created_by_id, content, is_voice_transcribed) VALUES ($1,$2,$3,$4)',
        [req.params.id, req.user.userId, req.body.content.trim(), req.body.is_voice_transcribed ? true : false]);
      await execute('UPDATE accounts SET last_contacted_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
      await logAudit(req, 'note', lastId, 'create', { account_id: req.params.id });
      res.status(201).json({ note: await queryOne('SELECT n.*, u.first_name, u.last_name FROM notes n JOIN users u ON n.created_by_id=u.id WHERE n.id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── ACTIVITIES ROUTES ───
  app.post('/api/accounts/:id/activities', authenticate, async (req, res) => {
    try {
      const { lastId } = await execute('INSERT INTO activities (account_id, rep_id, activity_type, description, completed_date) VALUES ($1,$2,$3,$4,NOW())',
        [req.params.id, req.user.userId, req.body.activity_type, req.body.description || null]);
      await execute('UPDATE accounts SET last_contacted_at=NOW(), updated_at=NOW() WHERE id=$1', [req.params.id]);
      await logAudit(req, 'activity', lastId, 'create', { account_id: req.params.id });
      res.status(201).json({ activity: await queryOne('SELECT act.*, u.first_name, u.last_name FROM activities act JOIN users u ON act.rep_id=u.id WHERE act.id=$1', [lastId]) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/activities/reminders', authenticate, async (req, res) => {
    const days = parseInt(req.query.days) || 14;
    const isRep = req.user.role === 'rep';
    let sql = `SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.status IN ('prospect','active') AND (a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - ($1 || ' days')::INTERVAL)`;
    const params = [days];
    if (isRep) { sql += ' AND a.assigned_rep_id = $2'; params.push(req.user.userId); }
    sql += ' ORDER BY a.last_contacted_at ASC NULLS FIRST LIMIT 50';
    res.json({ dormant: await queryAll(sql, params) });
  });

  // ─── SALES ROUTES ───
  app.get('/api/sales', authenticate, async (req, res) => {
    try {
      const { month, rep_id, account_id, page = '1', limit = '50' } = req.query;
      let where = []; let params = []; let idx = 1;
      if (month) { where.push(`s.month=$${idx++}`); params.push(month); }
      if (rep_id) { where.push(`s.rep_id=$${idx++}`); params.push(rep_id); }
      if (account_id) { where.push(`s.account_id=$${idx++}`); params.push(account_id); }
      const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
      const lim = parseInt(limit);
      const pg = parseInt(page);
      const tot = await queryOne(`SELECT COUNT(*) as total FROM sales_data s ${w}`, params);
      const totalCount = parseInt(tot?.total) || 0;

      let sales;
      if (lim === 0) {
        // limit=0 means fetch all records (no pagination)
        sales = await queryAll(`SELECT s.*, a.shop_name, u.first_name as rep_first_name, u.last_name as rep_last_name FROM sales_data s LEFT JOIN accounts a ON s.account_id=a.id LEFT JOIN users u ON s.rep_id=u.id ${w} ORDER BY s.sale_date DESC`,
          params);
      } else {
        sales = await queryAll(`SELECT s.*, a.shop_name, u.first_name as rep_first_name, u.last_name as rep_last_name FROM sales_data s LEFT JOIN accounts a ON s.account_id=a.id LEFT JOIN users u ON s.rep_id=u.id ${w} ORDER BY s.sale_date DESC LIMIT $${idx++} OFFSET $${idx++}`,
          [...params, lim, (pg-1)*lim]);
      }
      res.json({ sales, pagination: { page: pg, limit: lim, total: totalCount } });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/sales/import', authenticate, async (req, res) => {
    try {
      const { records } = req.body;
      if (!Array.isArray(records)) return res.status(400).json({ error: 'records array required' });
      const allAccounts = await queryAll('SELECT id, shop_name FROM accounts WHERE deleted_at IS NULL');
      let imported = 0; const unmatched = [];
      for (const r of records) {
        const name = r.customer_name || r['Customer Name'] || r['Name'] || '';
        const amt = parseFloat(r.amount || r['Amount'] || r['Total'] || 0);
        const date = r.date || r['Invoice Date'] || r['Date'] || '';
        const memo = r.memo || r['Memo'] || r['Description'] || '';
        const itemName = r.item_name || '';
        const quantity = parseInt(r.quantity) || 0;
        const cogs = parseFloat(r.cogs) || 0;
        const profit = parseFloat(r.profit) || 0;
        const category = r.category || '';
        const productLine = r.product_line || '';
        const salesperson = r.salesperson || '';
        if (!name || !amt || !date) continue;
        let matchId = null, best = 0;
        for (const a of allAccounts) {
          const s = similarity(name, a.shop_name);
          if (s > best && s >= 0.80) { best = s; matchId = a.id; }
        }
        const month = date.substring(0, 7);
        await execute('INSERT INTO sales_data (account_id,rep_id,sale_amount,sale_date,month,memo,customer_name,imported_from_accountedge,item_name,quantity,cogs,profit,category,product_line,salesperson) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',
          [matchId, req.user.userId, amt, date, month, memo, name, true, itemName, quantity, cogs, profit, category, productLine, salesperson]);
        if (!matchId) unmatched.push({ customer_name: name, amount: amt, date });
        imported++;
      }
      await logAudit(req, 'sale', null, 'import', { imported, unmatched: unmatched.length });
      res.json({ imported, unmatched, total: records.length });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CLEAR SALES DATA (admin only) ───
  app.delete('/api/sales/all', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const result = await queryOne('SELECT COUNT(*) as count FROM sales_data');
      const count = parseInt(result?.count) || 0;
      await execute('DELETE FROM sales_data');
      await logAudit(req, 'sale', null, 'delete', { action: 'clear_all_sales', records_deleted: count });
      res.json({ deleted: count, message: `All ${count} sales records have been deleted` });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── DASHBOARD ───
  app.get('/api/sales/dashboard/metrics', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      const uid = req.user.userId;

      const statusCounts = await queryAll(
        isRep
          ? 'SELECT status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND assigned_rep_id = $1 GROUP BY status'
          : 'SELECT status, COUNT(*) as count FROM accounts WHERE deleted_at IS NULL GROUP BY status',
        isRep ? [uid] : []);

      const monthlyRevenue = await queryAll(
        isRep
          ? 'SELECT month, SUM(sale_amount) as total, COUNT(*) as count FROM sales_data WHERE rep_id = $1 GROUP BY month ORDER BY month DESC LIMIT 12'
          : 'SELECT month, SUM(sale_amount) as total, COUNT(*) as count FROM sales_data GROUP BY month ORDER BY month DESC LIMIT 12',
        isRep ? [uid] : []);

      // Top accounts by revenue — pulled from sales report data (customer_name), not just matched accounts
      const topAccounts = await queryAll(
        isRep
          ? 'SELECT s.customer_name as shop_name, s.salesperson, SUM(s.sale_amount) as total_revenue, COUNT(s.id) as sale_count FROM sales_data s WHERE s.rep_id = $1 AND s.customer_name IS NOT NULL GROUP BY s.customer_name, s.salesperson ORDER BY total_revenue DESC LIMIT 15'
          : 'SELECT s.customer_name as shop_name, s.salesperson, SUM(s.sale_amount) as total_revenue, COUNT(s.id) as sale_count FROM sales_data s WHERE s.customer_name IS NOT NULL GROUP BY s.customer_name, s.salesperson ORDER BY total_revenue DESC LIMIT 15',
        isRep ? [uid] : []);

      const recentActivities = await queryAll(
        isRep
          ? 'SELECT act.*, a.shop_name, u.first_name, u.last_name FROM activities act JOIN accounts a ON act.account_id=a.id JOIN users u ON act.rep_id=u.id WHERE act.rep_id=$1 ORDER BY act.created_at DESC LIMIT 10'
          : 'SELECT act.*, a.shop_name, u.first_name, u.last_name FROM activities act JOIN accounts a ON act.account_id=a.id JOIN users u ON act.rep_id=u.id ORDER BY act.created_at DESC LIMIT 10',
        isRep ? [uid] : []);

      const dormantCount = await queryOne(
        isRep
          ? "SELECT COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND status IN ('prospect','active') AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '14 days') AND assigned_rep_id = $1"
          : "SELECT COUNT(*) as count FROM accounts WHERE deleted_at IS NULL AND status IN ('prospect','active') AND (last_contacted_at IS NULL OR last_contacted_at < NOW() - INTERVAL '14 days')",
        isRep ? [uid] : []);

      res.json({
        statusCounts: statusCounts.map(r => ({ ...r, count: parseInt(r.count) })),
        monthlyRevenue: monthlyRevenue.reverse().map(r => ({ ...r, total: parseFloat(r.total), count: parseInt(r.count) })),
        topAccounts: topAccounts.map(r => ({ ...r, total_revenue: parseFloat(r.total_revenue), sale_count: parseInt(r.sale_count) })),
        recentActivities,
        dormantCount: parseInt(dormantCount?.count) || 0,
        totalAccounts: statusCounts.reduce((s, c) => s + parseInt(c.count), 0)
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── SEARCH ───
  app.post('/api/search', authenticate, async (req, res) => {
    try {
      const q = (req.body.query || '').toLowerCase().trim();
      if (!q) return res.status(400).json({ error: 'Query required' });

      let where = ['a.deleted_at IS NULL']; let params = []; let idx = 1;
      const repMatch = q.match(/(?:michelle|ben|adam)(?:'s)?/i);
      if (repMatch) { where.push(`u.first_name ILIKE $${idx++}`); params.push(`%${repMatch[0].replace("'s",'')}%`); }

      const statusMap = { prospect:'prospect', prospects:'prospect', active:'active', customers:'active', clients:'active', cold:'cold', dnc:'dnc', 'do not contact':'dnc', churned:'churned' };
      for (const [kw, st] of Object.entries(statusMap)) { if (q.includes(kw)) { where.push(`a.status=$${idx++}`); params.push(st); break; } }

      const cityMatch = q.match(/(?:in|from|near)\s+([a-z\s]+?)(?:\s|$)/i);
      if (cityMatch) { where.push(`a.city ILIKE $${idx++}`); params.push(`%${cityMatch[1].trim()}%`); }

      if (q.includes('sherwin')) where.push('a.former_sherwin_client = true');
      if (q.includes('dormant') || q.includes("haven't contacted") || q.includes('overdue')) {
        where.push("(a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - INTERVAL '14 days')");
        where.push("a.status IN ('prospect','active')");
      }

      if (q.includes('notes') || q.includes('note')) {
        const ns = q.replace(/notes?|on|about|for|show|me|find|get|what/gi, '').trim();
        const results = await queryAll('SELECT n.*, a.shop_name, u.first_name, u.last_name FROM notes n JOIN accounts a ON n.account_id=a.id JOIN users u ON n.created_by_id=u.id WHERE a.shop_name ILIKE $1 OR n.content ILIKE $2 ORDER BY n.created_at DESC LIMIT 20',
          [`%${ns}%`, `%${ns}%`]);
        return res.json({ type: 'notes', results, query: q });
      }

      if (where.length === 1) {
        const terms = q.replace(/show|me|find|all|the|get|list|search|for|who|what|which|where/gi, '').trim();
        if (terms) { where.push(`(a.shop_name ILIKE $${idx} OR a.contact_names ILIKE $${idx+1} OR a.city ILIKE $${idx+2})`); const t = `%${terms}%`; params.push(t,t,t); idx += 3; }
      }

      const results = await queryAll(`SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE ${where.join(' AND ')} ORDER BY a.shop_name LIMIT 50`, params);

      // If no account results found, also search sales_data for customer names
      // This catches customers like "Universal Auto" that exist in sales imports but not as accounts
      if (results.length === 0) {
        const salesTerms = q.replace(/show|me|find|all|the|get|list|search|for|who|what|which|where/gi, '').trim();
        if (salesTerms) {
          const salesResults = await queryAll(
            `SELECT customer_name, account_id,
              SUM(sale_amount) as total_revenue,
              COUNT(*) as sale_count,
              MAX(sale_date) as last_sale_date
            FROM sales_data
            WHERE customer_name ILIKE $1
            GROUP BY customer_name, account_id
            ORDER BY total_revenue DESC
            LIMIT 20`,
            [`%${salesTerms}%`]
          );
          if (salesResults.length > 0) {
            return res.json({ type: 'sales_customers', results: salesResults.map(r => ({
              ...r,
              total_revenue: parseFloat(r.total_revenue),
              sale_count: parseInt(r.sale_count)
            })), query: q });
          }
        }
      }

      res.json({ type: 'accounts', results, query: q });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── NOTIFICATION ROUTES ───
  app.get('/api/notifications/settings', authenticate, async (req, res) => {
    try {
      const settings = await queryOne(
        'SELECT phone, notification_email, sms_enabled, email_enabled, daily_digest_time FROM users WHERE id=$1',
        [req.user.userId]
      );
      if (!settings) return res.status(404).json({ error: 'User not found' });
      res.json({ settings });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.put('/api/notifications/settings', authenticate, async (req, res) => {
    try {
      const { phone, notification_email, sms_enabled, email_enabled, daily_digest_time } = req.body;
      const updates = ['updated_at = NOW()'];
      const params = [];
      let idx = 1;

      if (phone !== undefined) { updates.push(`phone = $${idx++}`); params.push(phone || null); }
      if (notification_email !== undefined) { updates.push(`notification_email = $${idx++}`); params.push(notification_email || null); }
      if (sms_enabled !== undefined) { updates.push(`sms_enabled = $${idx++}`); params.push(sms_enabled ? true : false); }
      if (email_enabled !== undefined) { updates.push(`email_enabled = $${idx++}`); params.push(email_enabled ? true : false); }
      if (daily_digest_time !== undefined) { updates.push(`daily_digest_time = $${idx++}`); params.push(daily_digest_time || '07:30'); }

      params.push(req.user.userId);
      await execute(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, params);

      const updated = await queryOne('SELECT phone, notification_email, sms_enabled, email_enabled, daily_digest_time FROM users WHERE id=$1', [req.user.userId]);
      res.json({ settings: updated });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Helper function to generate daily digest
  async function generateDigestForUser(userId) {
    const user = await queryOne('SELECT * FROM users WHERE id=$1', [userId]);
    if (!user) return null;

    // Get follow-ups due today or overdue, with their latest follow-up note
    const dueFollowUps = await queryAll(
      `SELECT a.*, (
        SELECT n.content FROM notes n WHERE n.account_id = a.id AND n.content LIKE '[Follow-up%' ORDER BY n.created_at DESC LIMIT 1
      ) as follow_up_note
      FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.follow_up_date IS NOT NULL AND a.follow_up_date <= CURRENT_DATE ORDER BY a.follow_up_date ASC`,
      [userId]
    );

    // Get upcoming follow-ups (next 7 days)
    const upcomingFollowUps = await queryAll(
      `SELECT a.*, (
        SELECT n.content FROM notes n WHERE n.account_id = a.id AND n.content LIKE '[Follow-up%' ORDER BY n.created_at DESC LIMIT 1
      ) as follow_up_note
      FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.follow_up_date IS NOT NULL AND a.follow_up_date > CURRENT_DATE AND a.follow_up_date <= CURRENT_DATE + INTERVAL '7 days' ORDER BY a.follow_up_date ASC`,
      [userId]
    );

    // Get dormant accounts (no contact in 14+ days)
    const dormantAccounts = await queryAll(
      "SELECT a.* FROM accounts a WHERE a.deleted_at IS NULL AND a.assigned_rep_id = $1 AND a.status IN ('prospect', 'active') AND (a.last_contacted_at IS NULL OR a.last_contacted_at < NOW() - INTERVAL '14 days') ORDER BY a.last_contacted_at ASC NULLS FIRST LIMIT 10",
      [userId]
    );

    // Get new notes from other team members in last 24 hours
    const newNotes = await queryAll(
      'SELECT n.*, a.shop_name, u.first_name, u.last_name FROM notes n JOIN accounts a ON n.account_id = a.id JOIN users u ON n.created_by_id = u.id WHERE a.assigned_rep_id = $1 AND n.created_by_id != $1 AND n.created_at > NOW() - INTERVAL \'24 hours\' ORDER BY n.created_at DESC',
      [userId]
    );

    return {
      user,
      dueFollowUps,
      upcomingFollowUps,
      dormantAccounts,
      newNotes
    };
  }

  // Manager summary emails — aggregates all reps into one digest
  const MANAGER_EMAILS = (process.env.MANAGER_DIGEST_EMAILS || 'frankc@chcpaint.com,manny@chcpaint.com,adam@chcpaint.com').split(',').map(e => e.trim()).filter(Boolean);

  async function generateManagerSummary() {
    const reps = await queryAll("SELECT id, first_name, last_name FROM users WHERE is_active = true AND role IN ('rep','manager') ORDER BY first_name");
    const repDigests = [];
    for (const rep of reps) {
      const digest = await generateDigestForUser(rep.id);
      if (digest) repDigests.push(digest);
    }
    return repDigests;
  }

  function buildManagerSummaryText(repDigests) {
    let text = `TEAM DAILY SUMMARY — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' })}\n\n`;
    let totalDue = 0, totalUpcoming = 0, totalDormant = 0, totalNotes = 0;

    for (const d of repDigests) {
      totalDue += d.dueFollowUps.length;
      totalUpcoming += d.upcomingFollowUps.length;
      totalDormant += d.dormantAccounts.length;
      totalNotes += d.newNotes.length;

      text += `── ${d.user.first_name} ${d.user.last_name} ──\n`;
      if (d.dueFollowUps.length > 0) {
        text += `  Due Today: ${d.dueFollowUps.length}\n`;
        d.dueFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          text += `    • ${a.shop_name}${note}\n`;
        });
      }
      if (d.upcomingFollowUps.length > 0) {
        text += `  Upcoming: ${d.upcomingFollowUps.length}\n`;
        d.upcomingFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          text += `    • ${a.shop_name} (${a.follow_up_date})${note}\n`;
        });
      }
      text += `  Dormant: ${d.dormantAccounts.length}  |  New Notes: ${d.newNotes.length}\n\n`;
    }

    text = `Team Totals: ${totalDue} due today, ${totalUpcoming} upcoming, ${totalDormant} dormant\n\n` + text;
    return text;
  }

  function buildManagerSummaryHtml(repDigests) {
    const dateStr = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric', year: 'numeric' });
    let totalDue = 0, totalUpcoming = 0, totalDormant = 0, totalNotes = 0;
    for (const d of repDigests) {
      totalDue += d.dueFollowUps.length;
      totalUpcoming += d.upcomingFollowUps.length;
      totalDormant += d.dormantAccounts.length;
      totalNotes += d.newNotes.length;
    }

    let html = `<h2>Team Daily Summary — ${dateStr}</h2>`;
    html += `<p style="font-size:16px;"><strong>${totalDue}</strong> due today &nbsp;|&nbsp; <strong>${totalUpcoming}</strong> upcoming &nbsp;|&nbsp; <strong>${totalDormant}</strong> dormant &nbsp;|&nbsp; <strong>${totalNotes}</strong> new notes</p><hr/>`;

    for (const d of repDigests) {
      html += `<h3>${d.user.first_name} ${d.user.last_name}</h3>`;
      if (d.dueFollowUps.length > 0) {
        html += `<p><strong>Due Today (${d.dueFollowUps.length}):</strong></p><ul>`;
        d.dueFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          html += `<li><strong>${a.shop_name}</strong>${note}</li>`;
        });
        html += '</ul>';
      }
      if (d.upcomingFollowUps.length > 0) {
        html += `<p><strong>Upcoming This Week (${d.upcomingFollowUps.length}):</strong></p><ul>`;
        d.upcomingFollowUps.forEach(a => {
          const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
          html += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
        });
        html += '</ul>';
      }
      html += `<p>Dormant: ${d.dormantAccounts.length} &nbsp;|&nbsp; New Notes: ${d.newNotes.length}</p><hr/>`;
    }
    return html;
  }

  async function sendManagerSummary() {
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL;
    if (!sendgridApiKey || !sendgridFromEmail || MANAGER_EMAILS.length === 0) return;

    const repDigests = await generateManagerSummary();
    if (repDigests.length === 0) return;

    const htmlContent = buildManagerSummaryHtml(repDigests);
    const dateStr = new Date().toLocaleDateString();

    try {
      const sgMail = require('@sendgrid/mail');
      sgMail.setApiKey(sendgridApiKey);
      await sgMail.send({
        to: MANAGER_EMAILS,
        from: sendgridFromEmail,
        subject: `Team Daily Summary — ${dateStr}`,
        html: htmlContent
      });
      console.log(`Manager summary sent to: ${MANAGER_EMAILS.join(', ')}`);
    } catch (e) {
      console.warn(`Manager summary email failed: ${e.message}`);
    }
  }

  app.post('/api/notifications/send-digest', authenticate, async (req, res) => {
    try {
      // Admin-only check
      const user = await queryOne('SELECT role FROM users WHERE id=$1', [req.user.userId]);
      if (user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });

      const { user_id } = req.body;
      const userIds = user_id ? [user_id] : (await queryAll('SELECT id FROM users WHERE is_active = true')).map(u => u.id);

      const results = [];
      for (const uid of userIds) {
        const digest = await generateDigestForUser(uid);
        if (!digest) continue;

        const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
        const sendgridApiKey = process.env.SENDGRID_API_KEY;
        const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL;

        // Build digest message with follow-up details
        let digestText = `Daily Digest for ${digest.user.first_name}\n\n`;
        if (digest.dueFollowUps.length > 0) {
          digestText += `DUE TODAY (${digest.dueFollowUps.length}):\n`;
          digest.dueFollowUps.forEach(a => {
            digestText += `- ${a.shop_name}`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        if (digest.upcomingFollowUps.length > 0) {
          digestText += `UPCOMING THIS WEEK (${digest.upcomingFollowUps.length}):\n`;
          digest.upcomingFollowUps.forEach(a => {
            digestText += `- ${a.shop_name} (${a.follow_up_date})`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        digestText += `Dormant Accounts: ${digest.dormantAccounts.length}\nNew Notes: ${digest.newNotes.length}`;

        // Send SMS if enabled
        if (digest.user.sms_enabled && digest.user.phone && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
          try {
            const twilio = require('twilio');
            const client = twilio(twilioAccountSid, twilioAuthToken);
            await client.messages.create({
              body: digestText,
              from: twilioPhoneNumber,
              to: digest.user.phone
            });
            results.push({ userId: uid, sms: 'sent' });
          } catch (e) {
            console.warn(`SMS send failed for user ${uid}: ${e.message}`);
            results.push({ userId: uid, sms: 'failed', error: e.message });
          }
        }

        // Send email if enabled
        if (digest.user.email_enabled && digest.user.notification_email && sendgridApiKey && sendgridFromEmail) {
          try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(sendgridApiKey);
            let htmlContent = `<h2>Daily Digest for ${digest.user.first_name}</h2>`;
            if (digest.dueFollowUps.length > 0) {
              htmlContent += `<h3>Due Today (${digest.dueFollowUps.length})</h3><ul>`;
              digest.dueFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong>${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            if (digest.upcomingFollowUps.length > 0) {
              htmlContent += `<h3>Upcoming This Week (${digest.upcomingFollowUps.length})</h3><ul>`;
              digest.upcomingFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            htmlContent += `<p><strong>Dormant Accounts:</strong> ${digest.dormantAccounts.length}</p>
              <p><strong>New Notes from Team:</strong> ${digest.newNotes.length}</p>`;

            await sgMail.send({
              to: digest.user.notification_email,
              from: sendgridFromEmail,
              subject: `Daily Digest - ${new Date().toLocaleDateString()}`,
              html: htmlContent
            });
            results.push({ userId: uid, email: 'sent' });
          } catch (e) {
            console.warn(`Email send failed for user ${uid}: ${e.message}`);
            results.push({ userId: uid, email: 'failed', error: e.message });
          }
        }
      }

      // Send manager summary after individual digests
      if (!user_id) {
        try { await sendManagerSummary(); results.push({ manager_summary: 'sent', to: MANAGER_EMAILS }); }
        catch (e) { results.push({ manager_summary: 'failed', error: e.message }); }
      }

      res.json({ message: 'Digest sent', results });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/notifications/preview', authenticate, async (req, res) => {
    try {
      const digest = await generateDigestForUser(req.user.userId);
      if (!digest) return res.status(404).json({ error: 'Unable to generate digest' });

      res.json({
        preview: {
          dueFollowUps: digest.dueFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
          upcomingFollowUps: digest.upcomingFollowUps.map(a => ({ id: a.id, shop_name: a.shop_name, follow_up_date: a.follow_up_date, note: a.follow_up_note })),
          dormantAccounts: digest.dormantAccounts.map(a => ({ id: a.id, shop_name: a.shop_name, last_contacted_at: a.last_contacted_at })),
          newNotes: digest.newNotes.map(n => ({ id: n.id, shop_name: n.shop_name, author: `${n.first_name} ${n.last_name}`, created_at: n.created_at, content: n.content.substring(0, 100) }))
        }
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── FOLLOW-UP ROUTES ───
  app.post('/api/accounts/:id/follow-up', authenticate, async (req, res) => {
    try {
      const { follow_up_date, follow_up_notes } = req.body;
      if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date required' });

      // Update account with follow-up date
      await execute('UPDATE accounts SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [follow_up_date, req.params.id]);

      // Create note for follow-up
      const noteContent = `[Follow-up scheduled for ${follow_up_date}] ${follow_up_notes || ''}`;
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)', [req.params.id, req.user.userId, noteContent]);

      const account = await queryOne('SELECT * FROM accounts WHERE id=$1', [req.params.id]);
      res.json({ account });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── VOICE FOLLOW-UP (quick create from voice command) ───
  app.post('/api/voice-follow-up', authenticate, async (req, res) => {
    try {
      const { account_name, follow_up_date, notes } = req.body;
      if (!account_name) return res.status(400).json({ error: 'account_name required' });
      if (!follow_up_date) return res.status(400).json({ error: 'follow_up_date required' });

      // Find account by name (case-insensitive, partial match)
      let account = await queryOne(
        'SELECT id, shop_name FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
        [account_name.trim()]
      );

      // If no exact match, try ILIKE partial match
      if (!account) {
        account = await queryOne(
          'SELECT id, shop_name FROM accounts WHERE shop_name ILIKE $1 AND deleted_at IS NULL ORDER BY shop_name LIMIT 1',
          [`%${account_name.trim()}%`]
        );
      }

      if (!account) {
        return res.status(404).json({ error: `Could not find account "${account_name}"` });
      }

      // Set follow-up date on account
      await execute('UPDATE accounts SET follow_up_date = $1, updated_at = NOW() WHERE id = $2', [follow_up_date, account.id]);

      // Create note for the follow-up
      const noteContent = `[Follow-up scheduled for ${follow_up_date}] ${notes || ''}`.trim();
      await execute('INSERT INTO notes (account_id, created_by_id, content) VALUES ($1, $2, $3)', [account.id, req.user.userId, noteContent]);

      res.json({ success: true, account_id: account.id, shop_name: account.shop_name, follow_up_date, notes });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/follow-ups', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      let sql = 'SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.follow_up_date IS NOT NULL AND a.follow_up_date >= CURRENT_DATE';
      const params = [];

      if (isRep) {
        sql += ' AND a.assigned_rep_id = $1';
        params.push(req.user.userId);
      }

      sql += ' ORDER BY a.follow_up_date ASC LIMIT 50';
      const followUps = await queryAll(sql, params);
      res.json({ followUps });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/follow-ups/overdue', authenticate, async (req, res) => {
    try {
      const isRep = req.user.role === 'rep';
      let sql = 'SELECT a.*, u.first_name as rep_first_name, u.last_name as rep_last_name FROM accounts a LEFT JOIN users u ON a.assigned_rep_id=u.id WHERE a.deleted_at IS NULL AND a.follow_up_date IS NOT NULL AND a.follow_up_date < CURRENT_DATE';
      const params = [];

      if (isRep) {
        sql += ' AND a.assigned_rep_id = $1';
        params.push(req.user.userId);
      }

      sql += ' ORDER BY a.follow_up_date ASC LIMIT 50';
      const overdue = await queryAll(sql, params);
      res.json({ overdue });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CRON JOB FOR DAILY DIGEST ───
  const digestCron = process.env.DIGEST_CRON || '30 7 * * 1-5';
  cron.schedule(digestCron, async () => {
    console.log('Running daily digest...');
    try {
      const users = await queryAll('SELECT id FROM users WHERE is_active = true AND (sms_enabled = true OR email_enabled = true)');
      for (const user of users) {
        const digest = await generateDigestForUser(user.id);
        if (!digest) continue;

        const userData = digest.user;
        const twilioAccountSid = process.env.TWILIO_ACCOUNT_SID;
        const twilioAuthToken = process.env.TWILIO_AUTH_TOKEN;
        const twilioPhoneNumber = process.env.TWILIO_PHONE_NUMBER;
        const sendgridApiKey = process.env.SENDGRID_API_KEY;
        const sendgridFromEmail = process.env.SENDGRID_FROM_EMAIL;

        let digestText = `Daily Digest for ${userData.first_name}\n\n`;
        if (digest.dueFollowUps.length > 0) {
          digestText += `DUE TODAY (${digest.dueFollowUps.length}):\n`;
          digest.dueFollowUps.forEach(a => {
            digestText += `- ${a.shop_name}`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        if (digest.upcomingFollowUps.length > 0) {
          digestText += `UPCOMING THIS WEEK (${digest.upcomingFollowUps.length}):\n`;
          digest.upcomingFollowUps.forEach(a => {
            digestText += `- ${a.shop_name} (${a.follow_up_date})`;
            if (a.follow_up_note) digestText += ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}`;
            digestText += '\n';
          });
          digestText += '\n';
        }
        digestText += `Dormant Accounts: ${digest.dormantAccounts.length}\nNew Notes: ${digest.newNotes.length}`;

        // Send SMS
        if (userData.sms_enabled && userData.phone && twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
          try {
            const twilio = require('twilio');
            const client = twilio(twilioAccountSid, twilioAuthToken);
            await client.messages.create({
              body: digestText,
              from: twilioPhoneNumber,
              to: userData.phone
            });
          } catch (e) {
            console.warn(`SMS send failed for user ${userData.id}: ${e.message}`);
          }
        }

        // Send email
        if (userData.email_enabled && userData.notification_email && sendgridApiKey && sendgridFromEmail) {
          try {
            const sgMail = require('@sendgrid/mail');
            sgMail.setApiKey(sendgridApiKey);
            let htmlContent = `<h2>Daily Digest for ${userData.first_name}</h2>`;
            if (digest.dueFollowUps.length > 0) {
              htmlContent += `<h3>Due Today (${digest.dueFollowUps.length})</h3><ul>`;
              digest.dueFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong>${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            if (digest.upcomingFollowUps.length > 0) {
              htmlContent += `<h3>Upcoming This Week (${digest.upcomingFollowUps.length})</h3><ul>`;
              digest.upcomingFollowUps.forEach(a => {
                const note = a.follow_up_note ? ` — ${a.follow_up_note.replace(/^\[Follow-up[^\]]*\]\s*/, '')}` : '';
                htmlContent += `<li><strong>${a.shop_name}</strong> (${a.follow_up_date})${note}</li>`;
              });
              htmlContent += '</ul>';
            }
            htmlContent += `<p><strong>Dormant Accounts:</strong> ${digest.dormantAccounts.length}</p>
              <p><strong>New Notes from Team:</strong> ${digest.newNotes.length}</p>`;

            await sgMail.send({
              to: userData.notification_email,
              from: sendgridFromEmail,
              subject: `Daily Digest - ${new Date().toLocaleDateString()}`,
              html: htmlContent
            });
          } catch (e) {
            console.warn(`Email send failed for user ${userData.id}: ${e.message}`);
          }
        }
      }
      // Send combined manager summary
      try { await sendManagerSummary(); } catch (e) { console.warn('Manager summary cron error:', e.message); }

      console.log(`Digest cron completed for ${users.length} users`);
    } catch (e) {
      console.error('Digest cron error:', e.message);
    }
  });

  // ─── GOOGLE DRIVE AUTO-IMPORT ───

  // Manual trigger — admin only
  app.post('/api/gdrive-import/run', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      // Check if already running
      const running = await queryOne("SELECT id FROM gdrive_import_log WHERE status = 'running' AND created_at > NOW() - INTERVAL '10 minutes'");
      if (running) return res.status(409).json({ error: 'An import is already running' });

      // Mark as running
      await execute("INSERT INTO gdrive_import_log (status, triggered_by) VALUES ('running', 'manual')");

      const result = await runGDriveImport(queryAll, queryOne, execute);
      await logAudit(req, 'sale', null, 'import', { action: 'gdrive_auto_import', ...result });
      res.json(result);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Import history — admin/manager
  app.get('/api/gdrive-import/history', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin' && req.user.role !== 'manager') {
        return res.status(403).json({ error: 'Admin or manager access required' });
      }
      const history = await queryAll('SELECT * FROM gdrive_import_log ORDER BY created_at DESC LIMIT 30');
      res.json({ history });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Status check — is Google Drive configured?
  app.get('/api/gdrive-import/status', authenticate, async (req, res) => {
    try {
      if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const configured = !!(process.env.GDRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
      const lastRun = await queryOne("SELECT * FROM gdrive_import_log WHERE status != 'running' ORDER BY created_at DESC LIMIT 1");
      const cronSchedule = process.env.GDRIVE_IMPORT_CRON || '0 10 * * 1-5';
      res.json({ configured, lastRun, cronSchedule, folderId: process.env.GDRIVE_FOLDER_ID || null });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── CRON JOB FOR GOOGLE DRIVE IMPORT ───
  const gdriveCron = process.env.GDRIVE_IMPORT_CRON || '0 10 * * 1-5';
  if (process.env.GDRIVE_FOLDER_ID && process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    cron.schedule(gdriveCron, async () => {
      console.log('[GDrive Cron] Running scheduled import...');
      try {
        const result = await runGDriveImport(queryAll, queryOne, execute);
        console.log(`[GDrive Cron] Result: ${result.totalImported || 0} records from ${result.filesProcessed || 0} files`);
      } catch (e) {
        console.error('[GDrive Cron] Error:', e.message);
      }
    });
    console.log(`  Google Drive auto-import: scheduled (${gdriveCron})`);
  } else {
    console.log('  Google Drive auto-import: not configured (set GDRIVE_FOLDER_ID + GOOGLE_SERVICE_ACCOUNT_JSON)');
  }

  // ─── CUSTOMER SEED (admin-only bulk import from AccountEdge CSVs) ───
  app.post('/api/admin/seed-customers', authenticate, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Admin only' });
    try {
      const customers = require('./src/customer-seed.json');
      let imported = 0, skipped = 0, errors = [];

      for (const c of customers) {
        try {
          // Check if customer already exists (by name, case-insensitive)
          const existing = await queryOne(
            'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
            [c.shop_name]
          );
          if (existing) {
            // Update existing record to customer category and fill in any missing data
            const updates = [];
            const params = [];
            let idx = 1;
            updates.push(`account_category = 'customer'`);
            if (c.branch) { updates.push(`branch = $${idx++}`); params.push(c.branch); }
            if (c.address) { updates.push(`address = COALESCE(NULLIF(address,''), $${idx++})`); params.push(c.address); }
            if (c.city) { updates.push(`city = COALESCE(NULLIF(city,''), $${idx++})`); params.push(c.city); }
            if (c.province) { updates.push(`province = COALESCE(NULLIF(province,''), $${idx++})`); params.push(c.province); }
            if (c.postal_code) { updates.push(`postal_code = COALESCE(postal_code, $${idx++})`); params.push(c.postal_code); }
            if (c.phone) { updates.push(`phone = COALESCE(NULLIF(phone,''), $${idx++})`); params.push(c.phone); }
            if (c.phone2) { updates.push(`phone2 = COALESCE(phone2, $${idx++})`); params.push(c.phone2); }
            if (c.email) { updates.push(`email = COALESCE(NULLIF(email,''), $${idx++})`); params.push(c.email); }
            if (c.contact_names) { updates.push(`contact_names = COALESCE(NULLIF(contact_names,''), $${idx++})`); params.push(c.contact_names); }
            params.push(existing.id);
            await execute(`UPDATE accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
            imported++;
          } else {
            // Insert new customer
            await execute(
              `INSERT INTO accounts (shop_name, address, city, province, postal_code, phone, phone2, email, contact_names, branch, account_category, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'customer','active')`,
              [c.shop_name, c.address, c.city, c.province, c.postal_code, c.phone, c.phone2, c.email, c.contact_names, c.branch]
            );
            imported++;
          }
        } catch (err) {
          errors.push({ shop_name: c.shop_name, error: err.message });
          skipped++;
        }
      }

      // Also link sales_data to accounts where customer_name matches
      const unlinked = await queryAll(
        `SELECT DISTINCT sd.customer_name FROM sales_data sd WHERE sd.account_id IS NULL AND sd.customer_name IS NOT NULL`
      );
      let linked = 0;
      for (const row of unlinked) {
        const match = await queryOne(
          'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
          [row.customer_name]
        );
        if (match) {
          await execute('UPDATE sales_data SET account_id = $1 WHERE LOWER(customer_name) = LOWER($2) AND account_id IS NULL', [match.id, row.customer_name]);
          linked++;
        }
      }

      res.json({ success: true, total: customers.length, imported, skipped, linked_sales: linked, errors: errors.slice(0, 20) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ─── HEALTH ───
  app.get('/api/health', async (req, res) => {
    try {
      await queryOne('SELECT 1 as ok');
      res.json({ status: 'ok', app: 'CHC CRM', version: '1.1.0', database: 'supabase' });
    } catch (e) {
      res.status(500).json({ status: 'error', error: e.message });
    }
  });

  // Serve frontend
  const frontendPath = path.join(__dirname, '../frontend/dist');
  app.use(express.static(frontendPath));
  app.get('*', (req, res) => { if (!req.path.startsWith('/api')) res.sendFile(path.join(frontendPath, 'index.html')); });

  app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n  CRM - CHC Paint & Auto Body Supplies`);
    console.log(`  Server running on http://localhost:${PORT}`);
    console.log(`  Database: Supabase PostgreSQL\n`);

    // Auto-seed customers on first startup if none exist
    try {
      const customerCount = await queryOne("SELECT COUNT(*) as count FROM accounts WHERE account_category = 'customer' AND deleted_at IS NULL");
      if (parseInt(customerCount?.count) === 0) {
        console.log('  No active customers found — auto-seeding from AccountEdge exports...');
        const customers = require('./src/customer-seed.json');
        let imported = 0;
        for (const c of customers) {
          try {
            const existing = await queryOne(
              'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
              [c.shop_name]
            );
            if (existing) {
              // Existing lead — upgrade to customer and fill missing data
              const updates = ["account_category = 'customer'"];
              const params = [];
              let idx = 1;
              if (c.branch) { updates.push(`branch = $${idx++}`); params.push(c.branch); }
              if (c.address) { updates.push(`address = COALESCE(NULLIF(address,''), $${idx++})`); params.push(c.address); }
              if (c.city) { updates.push(`city = COALESCE(NULLIF(city,''), $${idx++})`); params.push(c.city); }
              if (c.province) { updates.push(`province = COALESCE(NULLIF(province,''), $${idx++})`); params.push(c.province); }
              if (c.postal_code) { updates.push(`postal_code = COALESCE(postal_code, $${idx++})`); params.push(c.postal_code); }
              if (c.phone) { updates.push(`phone = COALESCE(NULLIF(phone,''), $${idx++})`); params.push(c.phone); }
              if (c.phone2) { updates.push(`phone2 = COALESCE(phone2, $${idx++})`); params.push(c.phone2); }
              if (c.email) { updates.push(`email = COALESCE(NULLIF(email,''), $${idx++})`); params.push(c.email); }
              if (c.contact_names) { updates.push(`contact_names = COALESCE(NULLIF(contact_names,''), $${idx++})`); params.push(c.contact_names); }
              params.push(existing.id);
              await execute(`UPDATE accounts SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${idx}`, params);
            } else {
              await execute(
                `INSERT INTO accounts (shop_name, address, city, province, postal_code, phone, phone2, email, contact_names, branch, account_category, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'customer','active')`,
                [c.shop_name, c.address, c.city, c.province, c.postal_code, c.phone, c.phone2, c.email, c.contact_names, c.branch]
              );
            }
            imported++;
          } catch (err) { /* skip individual errors */ }
        }

        // Link sales_data to newly created customer accounts
        const unlinked = await queryAll(
          'SELECT DISTINCT customer_name FROM sales_data WHERE account_id IS NULL AND customer_name IS NOT NULL'
        );
        let linked = 0;
        for (const row of unlinked) {
          const match = await queryOne(
            'SELECT id FROM accounts WHERE LOWER(shop_name) = LOWER($1) AND deleted_at IS NULL',
            [row.customer_name]
          );
          if (match) {
            await execute('UPDATE sales_data SET account_id = $1 WHERE LOWER(customer_name) = LOWER($2) AND account_id IS NULL', [match.id, row.customer_name]);
            linked++;
          }
        }

        console.log(`  Auto-seed complete: ${imported} customers imported, ${linked} sales records linked`);
      } else {
        console.log(`  Active customers: ${customerCount.count} (seed not needed)`);
      }
    } catch (err) {
      console.error('  Auto-seed warning:', err.message);
    }
  });
}

startServer().catch(err => { console.error('Failed:', err); process.exit(1); });
