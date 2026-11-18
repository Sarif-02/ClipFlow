import { clipError, verifyLocal } from "@/lib/clips/http";
import { db } from "@/lib/clips/db";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  try {
    verifyLocal(request);
    return Response.json({ online: Boolean(await db().workerHeartbeat.count({ where: { seenAt: { gt: new Date(Date.now() - 15000) } } })) },
      { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return clipError(error); }
}
