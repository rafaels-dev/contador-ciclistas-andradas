import { connection } from "next/server";
import { tasksInProgress } from "@/lib/activity";
import { UpdateBanner } from "./update-banner";

/**
 * Desktop app update banner. The server only reports how many tasks are
 * running (restarting interrupts all of them); Electron knows about the new
 * version, read through the bridge in the banner itself.
 */
export async function Update() {
  await connection();
  return <UpdateBanner busy={tasksInProgress().length} />;
}
