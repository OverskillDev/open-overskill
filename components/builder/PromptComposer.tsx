"use client";
import { useId } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

export type PromptComposerProps = {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  suggestions: string[];
  suggestionLabels?: string[];
  disabled: boolean;
  busy: boolean;
  hasApp: boolean;
};

export function PromptComposer({
  value,
  onChange,
  onSubmit,
  suggestions,
  suggestionLabels,
  disabled,
  busy,
  hasApp,
}: PromptComposerProps) {
  const promptId = useId();
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <label htmlFor={promptId}>
        {hasApp
          ? "What would you like to change?"
          : "What would you like to build?"}
      </label>
      <textarea
        id={promptId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Describe an app for your community…"
        maxLength={10000}
        rows={4}
        disabled={busy}
      />
      <div className="composer-bottom">
        <span>
          {hasApp
            ? "Continue the same app"
            : "Your creator context is included"}
        </span>
        <button
          type="submit"
          aria-label={hasApp ? "Update app" : "Build app"}
          disabled={disabled || busy || !value.trim()}
        >
          {busy ? (
            <Loader2 size={19} className="animate-spin-slow" />
          ) : (
            <ArrowUp size={19} />
          )}
        </button>
      </div>
      {!hasApp && (
        <div className="prompt-suggestions">
          {suggestions.map((s, i) => (
            <button
              type="button"
              disabled={busy}
              title={s}
              key={s}
              onClick={() => onChange(s)}
            >
              {suggestionLabels?.[i] || s}
            </button>
          ))}
        </div>
      )}
    </form>
  );
}
