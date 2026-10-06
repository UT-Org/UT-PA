import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import { connectClient, pauseForRecovery } from "./temporal";
import { TASK_QUEUE } from "./types";
import { apiAvailable, monitorApi } from "./runtime-health";
import { ApplicationFailure } from "@temporalio/activity";

async function run(): Promise<void> {
  const client = await connectClient();
  await pauseForRecovery(client, "worker started or restarted");
  const connection = await NativeConnection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
  });
  const worker = await Worker.create({
    connection,
    namespace: "default",
    taskQueue: TASK_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities: {
      sendSimulatedOffer: async (
        input: Parameters<typeof activities.sendSimulatedOffer>[0],
      ) => {
        if (!(await apiAvailable()))
          throw ApplicationFailure.nonRetryable(
            "Application unavailable; manual review required",
            "RuntimeUnavailable",
          );
        return activities.sendSimulatedOffer(input);
      },
    },
  });
  console.log("Juniper worker is ready. Recovery pause has been recorded.");
  const stopMonitor = monitorApi(client);
  try {
    await worker.run();
  } finally {
    stopMonitor();
    await client.connection.close();
    await connection.close();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
