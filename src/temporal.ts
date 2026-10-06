import {
  Client,
  Connection,
  WorkflowNotFoundError,
  WorkflowExecutionAlreadyStartedError,
} from "@temporalio/client";
import { TASK_QUEUE, WORKFLOW_ID } from "./types";

export async function connectClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: process.env.TEMPORAL_ADDRESS ?? "127.0.0.1:7233",
  });
  return new Client({ connection, namespace: "default" });
}

export async function ensureSalon(client: Client) {
  try {
    await client.workflow.start("salonWorkflow", {
      workflowId: WORKFLOW_ID,
      taskQueue: TASK_QUEUE,
    });
  } catch (error) {
    if (!(error instanceof WorkflowExecutionAlreadyStartedError)) throw error;
  }
  return client.workflow.getHandle(WORKFLOW_ID);
}

/** Persist the pause BEFORE an API listens or a restarted worker polls tasks. */
export async function pauseForRecovery(client: Client, source: string) {
  try {
    await client.workflow
      .getHandle(WORKFLOW_ID)
      .signal("recoveryPause", source);
  } catch (error) {
    if (!(error instanceof WorkflowNotFoundError)) throw error;
  }
}
