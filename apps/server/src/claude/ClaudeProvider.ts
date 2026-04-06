import * as ChildProcess from "node:child_process";
import { Effect } from "effect";
import type { AuthStatus } from "@claude-desktop/contracts";

export function checkAuthStatus(binaryPath = "claude"): Effect.Effect<AuthStatus> {
  return Effect.callback<AuthStatus>((resume) => {
    const child = ChildProcess.spawn(binaryPath, ["auth", "status"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      const authenticated = code === 0;
      const subscriptionType = extractField(stdout, /Account type:\s*(.+)/i);
      const authMethod = extractField(stdout, /Auth method:\s*(.+)/i);
      resume(
        Effect.succeed({
          authenticated,
          subscriptionType: subscriptionType ?? undefined,
          authMethod: authMethod ?? undefined,
        }),
      );
    });
    child.on("error", () => {
      resume(Effect.succeed({ authenticated: false }));
    });
  });
}

function extractField(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match?.[1]?.trim() ?? null;
}
