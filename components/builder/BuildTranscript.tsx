import { Check, Circle, Loader2, Terminal } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
export function BuildTranscript({
  messages,
  busy,
}: {
  messages: ChatMessage[];
  busy: boolean;
}) {
  const assistant = [...messages].reverse().find((m) => m.role === "assistant");
  const blocks = assistant?.flow ?? [];
  return (
    <div className="transcript">
      <div className="small-label">
        <Terminal size={13} /> BUILD CONVERSATION
      </div>
      {blocks.length ? (
        blocks.map((block, i) => (
          <div key={i} className="transcript-block">
            {block.type === "message" ? (
              <p>{block.content}</p>
            ) : (
              <div className="tool-list">
                {block.tools?.map((t, j) => (
                  <span key={j}>
                    {["complete", "completed"].includes(t.status || "") ? (
                      <Check size={13} />
                    ) : t.status === "running" && busy ? (
                      <Loader2 size={13} className="animate-spin-slow" />
                    ) : (
                      <Circle size={10} />
                    )}{" "}
                    {t.name?.replaceAll("_", " ")}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))
      ) : (
        <p className="muted">
          {busy
            ? "Connecting to the build. Progress will appear here."
            : "Your build conversation and tool activity will appear here."}
        </p>
      )}
    </div>
  );
}
