import type { Client } from "@temporalio/client";
import { pauseForRecovery } from "./temporal";

/** No client data is exposed by the local health endpoint. */
export async function apiAvailable(): Promise<boolean> {
  try {
    const response = await fetch(
      `http://127.0.0.1:${process.env.PORT ?? 3000}/health`,
      { signal: AbortSignal.timeout(1000) },
    );
    return response.ok && (await response.json()).ok === true;
  } catch {
    return false;
  }
}

/** Detect API outages even while no offer timer is due. Recovery never resumes outreach. */
export function monitorApi(client: Client): () => void {
  let stopped = false;
  let outageRecorded = false;
  let timer: ReturnType<typeof setTimeout>;

  async function check() {
    const available = await apiAvailable();
    if (available) outageRecorded = false;
    else if (!outageRecorded) {
      try {
        await pauseForRecovery(client, "application unavailable");
        outageRecorded = true;
      } catch {
        /* Retry on the next health check if Temporal is also unavailable. */
      }
    }
    if (!stopped) timer = setTimeout(check, 2000);
  }

  timer = setTimeout(check, 2000);
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}
