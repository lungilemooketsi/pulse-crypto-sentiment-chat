import { describe, expect, it } from "vitest";
import { textToWorkersAiStream, toChatSse } from "../src/sse";

describe("toChatSse", () => {
  it("passes Meta Model API content through and drops reasoning text", async () => {
    const upstream = [
      `data: ${JSON.stringify({ choices: [{ delta: { role: "assistant", reasoning_content: "thinking about BTC" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: "**Mood**" } }] })}`,
      `data: ${JSON.stringify({ choices: [{ delta: { content: " mixed" }, finish_reason: "stop" }] })}`,
      "data: [DONE]",
      "",
    ].join("\n\n");

    const body = await new Response(toChatSse(textToWorkersAiStream(upstream))).text();

    expect(body).not.toContain("thinking");
    expect(body).toContain(JSON.stringify({ choices: [{ delta: { content: "**Mood**" } }] }));
    expect(body).toContain(JSON.stringify({ choices: [{ delta: { content: " mixed" } }] }));
    expect(body.match(/\[DONE\]/g)).toHaveLength(1);
  });
});
