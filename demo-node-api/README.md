# Demo Node API

Small Express API showing how to use the published `watchdock-errors` package from npm.

## Setup

```bash
cd demo-node-api
cp .env.example .env
npm install
```

Set `WATCHDOCK_API_KEY` in `.env` or export it in your shell.

## Run

```bash
npm start
```

The server starts on `http://localhost:4000` by default.

## Try It

Health check:

```bash
curl http://localhost:4000/health
```

Capture a custom message:

```bash
curl -X POST http://localhost:4000/message \
  -H "Content-Type: application/json" \
  -d '{"message":"Background sync completed with warnings"}'
```

Capture a handled exception:

```bash
curl http://localhost:4000/handled-error
```

Trigger an unhandled exception:

```bash
curl http://localhost:4000/unhandled-error
```
