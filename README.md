# demochat

WebSocket server for SwissPay Chat application.

## Local development

- Install dependencies: `npm install`
- Run Redis locally (Docker): `docker run -d -p 6379:6379 redis`
- Start the server: `node server.js` (or `PORT=8080 node server.js`)

## Deployment on Railway

1. Push this repo to GitHub and create a new Railway project (Deploy from GitHub).
2. In Railway, add the **Redis** plugin from the Marketplace — Railway will provision the service.
3. Railway will automatically provide a `REDIS_URL` environment variable. The server prefers `REDIS_URL`, but you can also configure:
	- `REDIS_HOST`, `REDIS_PORT`, `REDIS_USERNAME`, `REDIS_PASSWORD`
	- `PORT` (optional)
4. Deploy the project and check logs. Verify health with:

```
curl https://<your-service>.railway.app/health
```

Use the returned `wss` endpoint (e.g. `wss://<your-service>.railway.app`) in your client.
