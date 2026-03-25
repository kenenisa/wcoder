/**
 * Parse an ACP session/update event into a structured object.
 */
export function parseSessionUpdate(update) {
  if (!update) return null;

  const type = update.sessionUpdate;

  switch (type) {
    case "agent_message_chunk":
      return {
        type: "text_chunk",
        text: update.content?.text || "",
      };

    case "tool_call_started":
      return {
        type: "tool_start",
        callId: update.callId,
        tool: parseToolInfo(update.toolCall, "start"),
      };

    case "tool_call_completed":
      return {
        type: "tool_complete",
        callId: update.callId,
        tool: parseToolInfo(update.toolCall, "complete"),
      };

    case "agent_message_complete":
      return { type: "message_complete" };

    case "turn_complete":
      return { type: "turn_complete", stopReason: update.stopReason };

    default:
      return { type: "unknown", raw: update };
  }
}

function parseToolInfo(toolCall, phase) {
  if (!toolCall) return { name: "unknown", detail: "" };

  if (toolCall.readToolCall) {
    const args = toolCall.readToolCall.args || {};
    const info = { name: "read", path: args.path || "unknown" };
    if (phase === "complete" && toolCall.readToolCall.result?.success) {
      info.lines = toolCall.readToolCall.result.success.totalLines;
    }
    return info;
  }

  if (toolCall.writeToolCall) {
    const args = toolCall.writeToolCall.args || {};
    const info = { name: "write", path: args.path || "unknown" };
    if (phase === "complete" && toolCall.writeToolCall.result?.success) {
      info.linesCreated = toolCall.writeToolCall.result.success.linesCreated;
      info.fileSize = toolCall.writeToolCall.result.success.fileSize;
    }
    return info;
  }

  if (toolCall.function) {
    return {
      name: toolCall.function.name || "tool",
      args: toolCall.function.arguments,
    };
  }

  return { name: "unknown", raw: toolCall };
}

/**
 * Format a tool event into a human-readable status line.
 */
export function formatToolEvent(parsed) {
  if (parsed.type === "tool_start") {
    switch (parsed.tool.name) {
      case "read":
        return `📖 Reading ${parsed.tool.path}`;
      case "write":
        return `✏️ Writing ${parsed.tool.path}`;
      default:
        return `🔧 ${parsed.tool.name}`;
    }
  }

  if (parsed.type === "tool_complete") {
    switch (parsed.tool.name) {
      case "read":
        return `📖 Read ${parsed.tool.path} (${parsed.tool.lines ?? "?"} lines)`;
      case "write":
        return `✏️ Wrote ${parsed.tool.path} (${parsed.tool.linesCreated ?? "?"} lines)`;
      default:
        return `✓ ${parsed.tool.name} completed`;
    }
  }

  return null;
}

const TOOL_ICONS = { read: "📖", write: "✏️", shell: "💻", grep: "🔍", glob: "📂" };

export function getToolIcon(toolName) {
  return TOOL_ICONS[toolName] || "🔧";
}
