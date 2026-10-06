import { ApplicationFailure } from "@temporalio/activity";

/** Simulated transport. Definite failure stops outreach rather than skipping a client. */
export async function sendSimulatedOffer(input: {
  offerId: string;
  fail: boolean;
}): Promise<{ receipt: string }> {
  if (input.fail)
    throw ApplicationFailure.nonRetryable(
      "Simulated delivery failure",
      "DeliveryFailure",
    );
  // No network request, phone number, or message body is sent or logged.
  return { receipt: `simulated:${input.offerId}` };
}
