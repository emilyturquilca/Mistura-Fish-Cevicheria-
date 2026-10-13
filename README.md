# Mistura Fish · Panel analítico

Página estática (`index.html`) + una función segura (`api/loyverse.js`) que consulta la API de Loyverse.
No hay base de datos ni build: Vercel lo publica tal cual.

## Publicar (todo desde el navegador)
1. En GitHub crea un repositorio **privado** y sube estos archivos (Add file > Upload files).
2. En Vercel: Add New > Project > importa el repositorio. Framework: **Other**. Deploy.
3. En Vercel: Project > Settings > Environment Variables, agrega:
   - `LOYVERSE_TOKEN`: token de la API (Loyverse Back Office > Configuración > Tokens de acceso).
   - `APP_PASSWORD`: contraseña larga que usará la dueña para entrar.
4. Redeploy (Deployments > ... > Redeploy) para que tome las variables.
5. Abre la dirección que da Vercel, entra con la contraseña, ve a **Sincronizar Loyverse**, elige desde qué fecha cargar y presiona **Cargar historial**.

## Cómo funciona
- El navegador llama a `/api/loyverse`; la función agrega el token y reenvía a Loyverse. El token nunca llega al navegador.
- Los datos se guardan en el navegador de cada dispositivo (localStorage). Si se borran, se vuelven a descargar de Loyverse.
- Se sincroniza al abrir (máx. cada 5 min) y con el botón. No duplica ventas (clave: N.º de recibo).
- Se ignoran recibos anulados y reembolsos. Coste en 0 o vacío = "Información no disponible".
