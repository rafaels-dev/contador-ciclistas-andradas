import type { Job } from "./db";

/** Message key of each status (messages → status.*). */
export function statusKey(job: Pick<Job, "status" | "drive_id">): string {
  // a video from the computer is not downloaded: step 1 only reads the file in place
  if (job.status === "downloading" && job.drive_id === "local") return "status.opening";
  return `status.${job.status}`;
}

/** Steps of the flow, in order — the step bar on the video screen (messages → steps.*). */
export const STEPS = ["import", "lines", "detection", "suggestions", "review"] as const;

/** Index of the current step in STEPS (error: the step where it stopped is unknown → -1). */
export function currentStep(status: Job["status"]): number {
  switch (status) {
    case "downloading": return 0;
    case "awaiting_lines": return 1;
    case "detecting": return 2;
    case "suggesting": return 3;
    case "error": return -1;
    default: return 4;
  }
}
