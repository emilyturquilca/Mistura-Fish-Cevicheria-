// Proxy seguro hacia la API de Loyverse (solo lectura).
const PERMITIDAS = ['/receipts', '/items', '/categories', '/customers'];

const dec = value => {
  try {
    return decodeURIComponent(value || '');
  } catch (e) {
    return '';
  }
};

const json = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'no-store' }
});

export async function GET(request) {
  const url = new URL(request.url);
  const clave = process.env.APP_PASSWORD;
  const recibida = dec(request.headers.get('x-clave'));

  if (!clave || recibida !== clave) {
    return json({ error: 'No autorizado' }, 401);
  }

  const path = url.searchParams.get('path');
  if (path === '/ping') return json({ ok: true });
  if (!PERMITIDAS.includes(path)) return json({ error: 'Ruta no permitida' }, 400);

  const token = dec(request.headers.get('x-token')) || process.env.LOYVERSE_TOKEN;
  if (!token) {
    return json({ error: 'Falta el token de Loyverse. Guárdalo en el panel.' }, 400);
  }

  const destino = new URL('https://api.loyverse.com/v1.0' + path);
  url.searchParams.forEach((value, key) => {
    if (key !== 'path' && value) destino.searchParams.set(key, value);
  });

  try {
    const respuesta = await fetch(destino, {
      headers: { Authorization: 'Bearer ' + token }
    });

    if (respuesta.status === 401 || respuesta.status === 403) {
      return json({ error: 'Loyverse rechazó el token. Revísalo.' }, 502);
    }

    return new Response(await respuesta.text(), {
      status: respuesta.status,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Type': 'application/json'
      }
    });
  } catch (e) {
    return json({ error: 'No se pudo contactar a Loyverse' }, 502);
  }
}
