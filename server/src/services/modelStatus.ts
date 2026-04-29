export const MODEL_STATUS = {
  QUEUED: "queued",
  PROCESSING: "processing",
  COMPLETED: "completed",
  FAILED: "failed",
} as const;

export type ModelStatus = typeof MODEL_STATUS[keyof typeof MODEL_STATUS];

const MODEL_STATUS_VALUES = new Set<string>(Object.values(MODEL_STATUS));

export function isModelStatus(value: unknown): value is ModelStatus {
  return typeof value === "string" && MODEL_STATUS_VALUES.has(value);
}
