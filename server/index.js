import express from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { createClient } from '@libsql/client';
import { createHash, randomUUID } from 'node:crypto';

dotenv.config();
const app = express();
const port = Number(process.env.PORT || 3001);
const db = process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN ? createClient({ url: process.env.TURSO_DATABASE_URL, authToken: process.env.TURSO_AUTH_TOKEN }) : null;
const uploads = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024 }, fileFilter: (_req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)) });
app.use(cors()); app.use(express.json({ limit: '1mb' }));
const schema = `CREATE TABLE IF NOT EXISTS family_members (id TEXT PRIMARY KEY, name TEXT NOT NULL, birth_date TEXT, death_date TEXT, relationship TEXT, biography TEXT, photo_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); CREATE TABLE IF NOT EXISTS condolences (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE, author TEXT NOT NULL, message TEXT NOT NULL, photo_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);`;
async function ready() { if (!db) throw Object.assign(new Error('Configure TURSO_DATABASE_URL e TURSO_AUTH_TOKEN no arquivo .env.'), { status: 503 }); for (const statement of schema.split(';').map(x => x.trim()).filter(Boolean)) await db.execute(statement); }
async function seedInitialTribute() { await ready(); const existing = await db.execute({ sql: 'SELECT id FROM family_members WHERE id = ?', args: ['benedito-antonio-carneiro-rodrigues'] }); if (existing.rows.length) return; await db.execute({ sql: 'INSERT INTO family_members (id,name,birth_date,death_date,relationship,biography) VALUES (?,?,?,?,?,?)', args: ['benedito-antonio-carneiro-rodrigues','Benedito Antônio Carneiro Rodrigues','1966-07-06','2024-08-12','Pai','Foi um pai maravilhoso e esforçado. Trabalhou muito para sustentar seus seis filhos e deixou dois netos. Seu amor, sua dedicação e tudo o que construiu pela família permanecem vivos em cada um de nós.'] }); }
async function photoUrl(key) { return key && /^https:\/\//i.test(key) ? key : null; }
async function storePhoto(file) {
  if (!file) return null;
  if (!process.env.CLOUDINARY_CLOUD_NAME || !process.env.CLOUDINARY_API_KEY || !process.env.CLOUDINARY_API_SECRET) throw Object.assign(new Error('Configure o Cloudinary no arquivo .env para enviar fotos.'), { status: 503 });
  const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHash('sha1').update(`folder=memorial-familia&timestamp=${timestamp}${process.env.CLOUDINARY_API_SECRET}`).digest('hex');
  const form = new FormData();
  form.append('file', new Blob([file.buffer], { type: file.mimetype }), safeName);
  form.append('api_key', process.env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', 'memorial-familia');
  form.append('signature', signature);
  const response = await fetch(`https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`, { method: 'POST', body: form });
  if (!response.ok) throw Object.assign(new Error('O Cloudinary não aceitou o envio da foto.'), { status: 502 });
  const uploaded = await response.json();
  if (!uploaded.secure_url) throw Object.assign(new Error('O Cloudinary não retornou o endereço da foto.'), { status: 502 });
  return uploaded.secure_url;
}
app.get('/api/health', async (_req, res) => { try { await ready(); res.json({ ok: true, storage: Boolean(process.env.CLOUDINARY_CLOUD_NAME && process.env.CLOUDINARY_API_KEY && process.env.CLOUDINARY_API_SECRET) }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.get('/api/members', async (_req, res) => { try { await seedInitialTribute(); const result = await db.execute('SELECT * FROM family_members ORDER BY COALESCE(death_date, birth_date, created_at) DESC'); res.json(await Promise.all(result.rows.map(async row => ({ ...row, photo_url: await photoUrl(row.photo_key) })))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/members', uploads.single('photo'), async (req, res) => { try { await ready(); const { name, birth_date, death_date, relationship, biography } = req.body; if (!name?.trim()) return res.status(400).json({ error: 'Informe o nome da pessoa.' }); const id = randomUUID(); const photo_key = await storePhoto(req.file); await db.execute({ sql: 'INSERT INTO family_members (id,name,birth_date,death_date,relationship,biography,photo_key) VALUES (?,?,?,?,?,?,?)', args: [id, name.trim(), birth_date || null, death_date || null, relationship || null, biography || null, photo_key] }); res.status(201).json({ id }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.delete('/api/members/:id', async (req, res) => { try { await ready(); await db.execute('PRAGMA foreign_keys = ON'); await db.execute({ sql: 'DELETE FROM family_members WHERE id = ?', args: [req.params.id] }); res.status(204).end(); } catch (e) { res.status(500).json({ error: e.message }); } });
app.get('/api/members/:id/condolences', async (req, res) => { try { await ready(); const result = await db.execute({ sql: 'SELECT * FROM condolences WHERE member_id = ? ORDER BY created_at DESC', args: [req.params.id] }); res.json(await Promise.all(result.rows.map(async row => ({ ...row, photo_url: await photoUrl(row.photo_key) })))); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.post('/api/members/:id/condolences', uploads.single('photo'), async (req, res) => { try { await ready(); const { author, message } = req.body; if (!author?.trim() || !message?.trim()) return res.status(400).json({ error: 'Informe seu nome e escreva uma mensagem.' }); const exists = await db.execute({ sql: 'SELECT id FROM family_members WHERE id = ?', args: [req.params.id] }); if (!exists.rows.length) return res.status(404).json({ error: 'Pessoa não encontrada.' }); const id = randomUUID(); const photo_key = await storePhoto(req.file); await db.execute({ sql: 'INSERT INTO condolences (id,member_id,author,message,photo_key) VALUES (?,?,?,?,?)', args: [id, req.params.id, author.trim(), message.trim(), photo_key] }); res.status(201).json({ id }); } catch (e) { res.status(e.status || 500).json({ error: e.message }); } });
app.delete('/api/condolences/:id', async (req, res) => { try { await ready(); await db.execute({ sql: 'DELETE FROM condolences WHERE id = ?', args: [req.params.id] }); res.status(204).end(); } catch (e) { res.status(500).json({ error: e.message }); } });
app.listen(port, () => console.log(`API do memorial em http://localhost:${port}`));
