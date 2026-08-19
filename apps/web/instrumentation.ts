import * as Sentry from "@sentry/nextjs";
import { type Instrumentation } from "next";

export async function register() {
  if (process.env.NODE_ENV === "production") {
    if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_RUNTIME === "nodejs") {
      await import("./sentry.server.config");
    }
    if (process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.NEXT_RUNTIME === "edge") {
      await import("./sentry.edge.config");
    }
  }
}

export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  // Qualification CI has no external telemetry. Its failure logs are passed
  // through the runtime-file redactor before GitHub emits them, so opt in to a
  // bounded local diagnostic there instead of leaving a production error digest
  // as the only evidence. This flag is never set by the deployed profile.
  if (process.env.QUALIFICATION_RUNTIME_DIAGNOSTICS === "1") {
    let diagnostic = "non-Error thrown";
    if (err instanceof Error) diagnostic = err.stack ?? `${err.name}: ${err.message}`;
    console.error(`Qualification request failure:\n${diagnostic.slice(0, 8192)}`);
  }
  if (process.env.NODE_ENV === "production") {
    Sentry.captureRequestError(err, request, context);
  }
};
