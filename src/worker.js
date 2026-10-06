const MEMBER_ID = 'benedito-antonio-carneiro-rodrigues';
const MEMBER_BIO = 'Foi um pai maravilhoso e esforçado. Trabalhou muito para sustentar seus seis filhos e deixou dois netos. Seu amor, sua dedicação e tudo o que construiu pela família permanecem vivos em cada um de nós.';
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;

const statements = [
  'CREATE TABLE IF NOT EXISTS family_members (id TEXT PRIMARY KEY, name TEXT NOT NULL, birth_date TEXT, death_date TEXT, relationship TEXT, biography TEXT, photo_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
  'CREATE TABLE IF NOT EXISTS condolences (id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES family_members(id) ON DELETE CASCADE, author TEXT NOT NULL, message TEXT NOT NULL, photo_key TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)',
];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

function toSqlValue(value) {
  if (value === null || value === undefined) return { type: 'null' };
  if (typeof value === 'number') return Number.isInteger(value)
    ? { type: 'integer', value: String(value) }
    : { type: 'float', value };
  return { type: 'text', value: String(value) };
}

function fromSqlValue(value) {
  if (!value || value.type === 'null') return null;
  if (value.type === 'integer') return Number(value.value);
  if (value.type === 'float') return value.value;
  return value.value;
}

async function execute(env, sql, args = []) {
  if (!env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN) {
    throw Object.assign(new Error('Configuração do Turso incompleta.'), { status: 503 });
  }
  const url = new URL(env.TURSO_DATABASE_URL.replace(/^libsql:/, 'https:'));
  url.pathname = `${url.pathname.replace(/\/$/, '')}/v2/pipeline`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.TURSO_AUTH_TOKEN}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ requests: [
      { type: 'execute', stmt: { sql, args: args.map(toSqlValue) } },
      { type: 'close' },
    ] }),
  });
  const payload = await response.json();
  if (!response.ok || payload?.results?.[0]?.type === 'error') {
    throw Object.assign(new Error('Não foi possível consultar o banco de dados.'), { status: 502 });
  }
  return payload?.results?.[0]?.response?.result ?? { cols: [], rows: [] };
}

async function ready(env) {
  for (const sql of statements) await execute(env, sql);
}

function rowsOf(result) {
  const columns = (result.cols || []).map(column => column.name);
  return (result.rows || []).map(row => Object.fromEntries(
    row.map((value, index) => [columns[index] || String(index), fromSqlValue(value)]),
  ));
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

async function putPhoto(env, file) {
  if (!file || file.size === 0) return null;
  if (!IMAGE_TYPES.has(file.type)) throw Object.assign(new Error('Formato de foto não aceito.'), { status: 415 });
  if (file.size > MAX_IMAGE_SIZE) throw Object.assign(new Error('A foto deve ter no máximo 8 MB.'), { status: 413 });
  if (!env.CLOUDINARY_CLOUD_NAME || !env.CLOUDINARY_API_KEY || !env.CLOUDINARY_API_SECRET) {
    throw Object.assign(new Error('Configuração do Cloudinary incompleta.'), { status: 503 });
  }
  const safeName = (file.name || 'foto').replace(/[^a-zA-Z0-9._-]/g, '_');
  const timestamp = Math.floor(Date.now() / 1000);
  const signatureSource = `folder=memorial-familia&timestamp=${timestamp}${env.CLOUDINARY_API_SECRET}`;
  const signatureBytes = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(signatureSource));
  const form = new FormData();
  form.append('file', file, safeName);
  form.append('api_key', env.CLOUDINARY_API_KEY);
  form.append('timestamp', String(timestamp));
  form.append('folder', 'memorial-familia');
  form.append('signature', hex(signatureBytes));
  const response = await fetch(`https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) throw Object.assign(new Error('O Cloudinary não aceitou o envio da foto.'), { status: 502 });
  const uploaded = await response.json();
  if (!uploaded.secure_url) throw Object.assign(new Error('O Cloudinary não retornou o endereço da foto.'), { status: 502 });
  return uploaded.secure_url;
}

function withPhotoUrl(member) {
  const photoUrl = member.photo_key && /^https:\/\//i.test(member.photo_key)
    ? member.photo_key
    : member.photo_key ? `/api/media/${encodeURIComponent(member.photo_key)}` : null;
  return { ...member, photo_url: photoUrl };
}

async function seedInitialTribute(env) {
  await ready(env);
  const existing = rowsOf(await execute(env, 'SELECT id FROM family_members WHERE id = ?', [MEMBER_ID]));
  if (existing.length) return;
  await execute(env,
    'INSERT OR IGNORE INTO family_members (id,name,birth_date,death_date,relationship,biography) VALUES (?,?,?,?,?,?)',
    [MEMBER_ID, 'Benedito Antônio Carneiro Rodrigues', '1966-07-06', '2024-08-12', 'Pai', MEMBER_BIO],
  );
}

async function apiRequest(request, env, url) {
  try {
    const path = url.pathname;
    const method = request.method;

    if (path === '/api/health' && method === 'GET') {
      await ready(env);
      return json({ ok: true, database: true, storage: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET) });
    }

    if (path === '/api/members' && method === 'GET') {
      await seedInitialTribute(env);
      const members = rowsOf(await execute(env, 'SELECT * FROM family_members ORDER BY COALESCE(death_date, birth_date, created_at) DESC'));
      return json(members.map(withPhotoUrl));
    }

    if (path === '/api/members' && method === 'POST') {
      await ready(env);
      const form = await request.formData();
      const name = String(form.get('name') || '').trim();
      if (!name) return json({ error: 'Informe o nome da pessoa.' }, 400);
      const id = crypto.randomUUID();
      const photoKey = await putPhoto(env, form.get('photo'));
      await execute(env,
        'INSERT INTO family_members (id,name,birth_date,death_date,relationship,biography,photo_key) VALUES (?,?,?,?,?,?,?)',
        [id, name, form.get('birth_date') || null, form.get('death_date') || null, form.get('relationship') || null, form.get('biography') || null, photoKey],
      );
      return json({ id }, 201);
    }

    const memberCondolences = path.match(/^\/api\/members\/([^/]+)\/condolences$/);
    if (memberCondolences && method === 'GET') {
      await ready(env);
      const memberId = decodeURIComponent(memberCondolences[1]);
      const items = rowsOf(await execute(env, 'SELECT * FROM condolences WHERE member_id = ? ORDER BY created_at DESC', [memberId]));
      return json(items.map(withPhotoUrl));
    }
    if (memberCondolences && method === 'POST') {
      await ready(env);
      const memberId = decodeURIComponent(memberCondolences[1]);
      const members = rowsOf(await execute(env, 'SELECT id FROM family_members WHERE id = ?', [memberId]));
      if (!members.length) return json({ error: 'Pessoa não encontrada.' }, 404);
      const form = await request.formData();
      const author = String(form.get('author') || '').trim();
      const message = String(form.get('message') || '').trim();
      if (!author || !message) return json({ error: 'Informe seu nome e escreva uma mensagem.' }, 400);
      const id = crypto.randomUUID();
      const photoKey = await putPhoto(env, form.get('photo'));
      await execute(env,
        'INSERT INTO condolences (id,member_id,author,message,photo_key) VALUES (?,?,?,?,?)',
        [id, memberId, author, message, photoKey],
      );
      return json({ id }, 201);
    }

    const member = path.match(/^\/api\/members\/([^/]+)$/);
    if (member && method === 'DELETE') {
      await ready(env);
      const id = decodeURIComponent(member[1]);
      await execute(env, 'DELETE FROM condolences WHERE member_id = ?', [id]);
      await execute(env, 'DELETE FROM family_members WHERE id = ?', [id]);
      return new Response(null, { status: 204 });
    }

    const condolence = path.match(/^\/api\/condolences\/([^/]+)$/);
    if (condolence && method === 'DELETE') {
      await ready(env);
      await execute(env, 'DELETE FROM condolences WHERE id = ?', [decodeURIComponent(condolence[1])]);
      return new Response(null, { status: 204 });
    }

    return json({ error: 'Rota da API não encontrada.' }, 404);
  } catch (error) {
    return json({ error: error.status ? error.message : 'Erro ao processar a solicitação.' }, error.status || 500);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return apiRequest(request, env, url);
    return env.ASSETS.fetch(request);
  },
};
