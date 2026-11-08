#!/usr/bin/env node
// E-Calculator MCP server (stdio). No dependencies: JSON-RPC 2.0, one message per line.
// Add to an MCP client:  { "command": "npx", "args": ["-y", "github:Chaouch-Haroun/E-Calculator"] }
import { createInterface } from "node:readline";
import { TOOLS, callTool } from "./core.mjs";

const INFO = { name: "e-calculator", title: "E-Calculator", version: "1.1.0" };
const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"];
const INSTRUCTIONS = "Profit calculator for e-commerce sellers in Tunisia who sell with cash on delivery. Amounts are in Tunisian dinars (TND); "
  + "ads are usually paid in USD and converted with usd_to_tnd. Use calculate_profit for a period's numbers, profit_sensitivity for what-if questions "
  + "and break-even points, daily_report for day-by-day numbers. Before asking the seller to type anything, fetch the numbers yourself from what you can "
  + "access: connected tools (ads manager such as Meta Ads, Google Sheets or Drive, the online shop, the courier's statements) and files or screenshots "
  + "the seller shared. Only ask for what you cannot find, never guess required numbers, "
  + "and answer in the seller's language (often French, Tunisian Darija or Arabic). Benchmarks are indicative.";

const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
const reply = (id, result) => send({ jsonrpc: "2.0", id, result });
const fail = (id, code, message) => send({ jsonrpc: "2.0", id, error: { code, message } });

function handle(msg) {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") return;
  const { id, method, params = {} } = msg;
  const isRequest = id !== undefined && id !== null && typeof method === "string";
  if (!isRequest) return;                                   // notifications and responses need no answer
  switch (method) {
    case "initialize":
      return reply(id, {
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: INFO,
        instructions: INSTRUCTIONS,
      });
    case "ping":
      return reply(id, {});
    case "tools/list":
      return reply(id, { tools: TOOLS });
    case "tools/call": {
      if (!TOOLS.some((t) => t.name === params.name)) return fail(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const out = callTool(params.name, params.arguments);
        return reply(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], structuredContent: out, isError: false });
      } catch (e) {                                         // bad input: reported to the model so it can fix the call
        return reply(id, { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${method}`);
  }
}

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); } catch { return fail(null, -32700, "Parse error"); }
  for (const m of Array.isArray(msg) ? msg : [msg]) handle(m);
});
process.stdin.on("end", () => process.exit(0));
