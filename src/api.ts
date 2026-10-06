import { randomBytes } from "node:crypto";
import { createApp } from "./app";
import { connectClient, ensureSalon, pauseForRecovery } from "./temporal";
import type { CommandResult, SalonState } from "./types";

async function run() {
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error("Invalid PORT.");
  const client = await connectClient();
  await pauseForRecovery(client, "application started or restarted");
  const handle = await ensureSalon(client);

  const deadline = <T>(operation: () => Promise<T>) =>
    client.connection.withDeadline(Date.now() + 8_000, operation);

  const accessCode =
    process.env.JUNIPER_ACCESS_CODE ?? randomBytes(24).toString("hex");
  if (accessCode.length < 24)
    throw new Error("JUNIPER_ACCESS_CODE must contain at least 24 characters.");
  const app = createApp(
    {
      status: () => deadline(() => handle.query<SalonState>("getSalon")),
      execute: (input, requestId) =>
        deadline(() =>
          handle.executeUpdate<CommandResult, [typeof input]>("command", {
            args: [input],
            updateId: requestId,
          }),
        ),
    },
    accessCode,
    port,
  );
  const server = app.listen(port, "127.0.0.1", () => {
    console.log(`Juniper Salon: http://localhost:${port}`);
    if (!process.env.JUNIPER_ACCESS_CODE)
      console.log(`Staff access code (local demo only): ${accessCode}`);
  });
  server.on("error", () => {
    console.error("Cannot listen on the selected local port.");
    process.exit(1);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const)
    process.on(signal, () => {
      server.close(() => {
        void client.connection.close().then(() => process.exit(0));
      });
    });
}

run().catch(() => {
  console.error(
    "API startup failed. Ensure Temporal is running and check the local configuration.",
  );
  process.exit(1);
});
