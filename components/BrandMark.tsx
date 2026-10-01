import { builderConfig } from "@/lib/builder-config";

// Retain the reference wordmark by default; every custom name renders as text.
export function BrandName({ lightClassName }: { lightClassName?: string }) {
  return builderConfig.name === "Open Overskill"
    ? <>open<span className={lightClassName}>overskill</span></>
    : <>{builderConfig.name}</>;
}

export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <span
      className="brand-mark"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      <svg
        width={size * 0.66}
        height={size * 0.66}
        viewBox="0 0 24 24"
        fill="none"
      >
        <path
          d="m9 5-7 7 7 7M15 5l7 7-7 7m-2-17-2 20"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
