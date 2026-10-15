import { neon } from '@neondatabase/serverless';
import '../sales-core.js';
import '../operations-core.js';
import '../operations-edit-core.js';

const O = globalThis.MisturaOperations;
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
let sql;
function db() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_NOT_CONFIGURED');
  return sql ||= neon(process.env.DATABASE_URL);
}
export function authorized(request) {
  let password; try { password = decodeURIComponent(request.headers.get('x-clave') || ''); } catch { return false; }
  return Boolean(process.env.APP_PASSWORD) && password === process.env.APP_PASSWORD;
}
export async function load() {
  const q = db();
  await q`CREATE TABLE IF NOT EXISTS mistura_operations (id integer PRIMARY KEY CHECK (id = 1), version bigint NOT NULL DEFAULT 0, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now())`;
  await q`INSERT INTO mistura_operations (id, data) VALUES (1, ${JSON.stringify(O.initial())}::jsonb) ON CONFLICT (id) DO NOTHING`;
  const [row] = await q`SELECT version, data FROM mistura_operations WHERE id = 1`;
  return { version: Number(row.version), state: row.data };
}
export function error(e) {
  if (e.message === 'DATABASE_NOT_CONFIGURED') return json({ error: 'La base compartida aún no está conectada. Falta DATABASE_URL en el servidor.', configured: false }, 503);
  console.error('Operations database request failed:', e.name);
  return json({ error: 'No se pudo acceder a la base compartida. Tus cambios no se confirmaron; vuelve a actualizar antes de repetir.' }, 503);
}
export async function save(next, version) {
  const [row] = await db()`UPDATE mistura_operations SET data = ${JSON.stringify(next)}::jsonb, version = version + 1, updated_at = now() WHERE id = 1 AND version = ${version} RETURNING version`;
  return row ? Number(row.version) : null;
}
export async function GET(request) {
  if (!authorized(request)) return json({ error: 'No autorizado' }, 401);
  try { return json({ configured: true, ...await load() }); } catch (e) { return error(e); }
}
export async function POST(request) {
  if (!authorized(request)) return json({ error: 'No autorizado' }, 401);
  if (Number(request.headers.get('content-length') || 0) > 3e6) return json({ error: 'Solicitud demasiado grande.' }, 413);
  let command;
  try {
    const body = await request.text();
    if (body.length > 3e6) return json({ error: 'Solicitud demasiado grande.' }, 413);
    command = JSON.parse(body);
    if (!command.id || typeof command.id !== 'string' || command.id.length > 100 || !Number.isSafeInteger(command.version)) throw new Error();
  } catch { return json({ error: 'Solicitud inválida.' }, 400); }
  try {
    const current = await load();
    if (current.state.commands.some(c => c.id === command.id)) return json({ configured: true, ...current, duplicate: true });
    if (current.version !== command.version) return json({ error: 'Otro dispositivo actualizó los datos. Actualiza y vuelve a revisar el formulario.', ...current }, 409);
    let next;
    try { next = O.apply(current.state, command).state; } catch (e) { return json({ error: e.message }, 400); }
    const version = await save(next, current.version);
    if (version == null) return json({ error: 'Otro dispositivo guardó primero. Actualiza y revisa los datos antes de repetir.' }, 409);
    return json({ configured: true, state: next, version });
  } catch (e) { return error(e); }
}
