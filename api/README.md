# api/loyverse.js

Vercel serverless function that forwards **read-only** requests to the Loyverse API (`https://api.loyverse.com/v1.0`) adding the secret token on the server.

This function uses Vercel's Web API format (`export function GET(request)`), so the project root deployed in Vercel must contain both `package.json` and the `api/loyverse.js` file.

## Request
`GET /api/loyverse?path=<route>&<other Loyverse query params>`

| Header | Value |
|---|---|
| `x-clave` | The `APP_PASSWORD` value, URL-encoded with `encodeURIComponent` (so any character is allowed) |
| `x-token` | Optional device-only fallback, URL-encoded. The server's `LOYVERSE_TOKEN` takes priority |

`path=/ping` checks the password and returns `{ ok: true, loyverseConfigured: boolean }` without contacting Loyverse or exposing the token. Set `LOYVERSE_TOKEN` in Vercel and redeploy to share the connection across devices. A local `.env.local` does not configure a deployed Vercel project. Allowed `path` values: `/receipts`, `/items`, `/categories`, `/customers`. Anything else returns `400`.
Other query params (`limit`, `cursor`, `updated_at_min`, …) are passed through unchanged.

## Responses
| Status | Meaning |
|---|---|
| 200 | Loyverse response, passed through as JSON |
| 400 | `path` not allowed |
| 401 | Missing or wrong `x-clave` |
| 400 | No token (neither `x-token` nor `LOYVERSE_TOKEN`) |
| 502 | Loyverse rejected the token (401/403) |
| 502 | Loyverse could not be reached |
| other | Status returned by Loyverse (e.g. 401/403 invalid token, 429 rate limit) |

If `/api/loyverse?path=/ping` returns `404`, Vercel did not publish the function. Check that the project Root Directory is the folder that contains this `api` directory, then redeploy.

## Example
```bash
curl -H "x-clave: YOUR_PASSWORD" "https://YOUR-APP.vercel.app/api/loyverse?path=/categories&limit=10"
```

## Security notes
- The token comes from `process.env.LOYVERSE_TOKEN`, with `x-token` as a fallback; it is never returned or logged by the function. A configured server token cannot be overridden by an older browser token.
- Only the four GET routes above are exposed, so the proxy cannot modify data in Loyverse.
- Use a long `APP_PASSWORD`; it is the only protection for the endpoint.
