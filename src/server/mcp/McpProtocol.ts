// ============================================================================
// McpProtocol.ts — Pure types describing the JSON-RPC subset of MCP that
// fm-server drives. The McpClient writes/reads these over
// stdio or HTTP.
//
// Port of Sources/Core/MCPProtocol.swift.
// ============================================================================

import type { OpenAITool } from "../openai/index.js";

/** JSON-RPC request body. */
export interface McpRequest {
  jsonrpc: "2.0";
  id: number | string;
  method: string;
  params?: unknown;
}

/** JSON-RPC successful response body. */
export interface McpResponse<T = unknown> {
  jsonrpc: "2.0";
  id: number | string;
  result?: T;
  error?: McpRpcError;
}

export interface McpRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type McpInitializeResult = {
  protocolVersion: string;
  capabilities?: Record<string, unknown>;
  serverInfo?: { name?: string; version?: string };
};

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface McpToolsListResult {
  tools: McpToolDescriptor[];
}

export type McpToolCallResult = {
  content?: Array<{ type: string; text?: string }>;
  isError?: boolean;
};

/** Convert an MCP tool descriptor into the OpenAI `tool` shape we send to the model. */
export function mcpToolToOpenAI(t: McpToolDescriptor): OpenAITool {
  return {
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema ?? { type: "object", properties: {} },
    },
  };
}
