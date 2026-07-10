import "dotenv/config";
import express from "express";
import { captureException, captureMessage, flush, init } from "watchdock-errors";
import { watchdockErrorHandler, watchdockRequestHandler } from "watchdock-errors/express";

const PORT = Number(process.env.PORT || 4000);
const WATCHDOCK_API_KEY = process.env.WATCHDOCK_API_KEY;

if (!WATCHDOCK_API_KEY) {
  console.error("Missing WATCHDOCK_API_KEY. Add it to your environment before starting the demo API.");
  process.exit(1);
}

init({
  apiKey: WATCHDOCK_API_KEY,
  environment: process.env.NODE_ENV || "development",
  release: "demo-node-api@0.1.0",
  serverName: "demo-node-api",
  sendPii: false,
  onError: (error) => {
    console.error("Watchdock SDK send failed:", error);
  },
});

const app = express();

app.use(express.json());
app.use(
  watchdockRequestHandler({
    includeBody: false,
    mapUser: (req) => {
      const userId = req.headers["x-demo-user-id"];
      const email = req.headers["x-demo-user-email"];

      return {
        id: Array.isArray(userId) ? userId[0] : userId,
        email: Array.isArray(email) ? email[0] : email,
      };
    },
  }),
);

app.get("/", (_req, res) => {
  res.json({
    name: "watchdock-errors demo node api",
    routes: {
      health: "GET /health",
      message: "POST /message",
      handledError: "GET /handled-error",
      unhandledError: "GET /unhandled-error",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/message", (req, res) => {
  const text = typeof req.body?.message === "string" ? req.body.message : "Demo message event";

  captureMessage(text, {
    title: "Demo custom message",
  });

  res.status(202).json({ status: "captured", type: "message", message: text });
});

app.get("/handled-error", (_req, res) => {
  try {
    throw new Error("Handled demo error from Node API");
  } catch (error) {
    captureException(error, {
      title: "Handled demo exception",
    });
  }

  res.status(202).json({ status: "captured", type: "handled_exception" });
});

app.get("/unhandled-error", () => {
  throw new Error("Unhandled demo error from Node API");
});

app.use(watchdockErrorHandler());

app.listen(PORT, () => {
  console.log(`Demo API running on http://localhost:${PORT}`);
});

async function shutdown(signal) {
  console.log(`Received ${signal}. Flushing Watchdock events before exit...`);
  await flush();
  process.exit(0);
}

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
