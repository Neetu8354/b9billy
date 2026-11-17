import { getAdmin, adminCanAccess, getUserById, emitToAdmins, invalidateUserSessions } from "@/lib/db";
import { remote, remoteOn } from "@/lib/remote";

export const dynamic = "force-dynamic";

export async function POST(req) {
  const admin = await getAdmin();
  if (!admin) return Response.json({ success: false }, { status: 401 });
  let b = {};
  try { b = await req.json(); } catch {}
  const userId = Number(b.userId);
  const name = String(b.name || "").trim().slice(0, 80);
  if (!userId || !name) return Response.json({ success: false, error: "Name required" }, { status: 400 });
  const u = await getUserById(userId);
  if (!u) return Response.json({ success: false }, { status: 404 });
  if (!adminCanAccess(admin, u)) return Response.json({ success: false, error: "Not your user" }, { status: 403 });

  if (remoteOn) await remote.patchUser(userId, { display_name: name });
  else { const { db, save } = await import("@/lib/db"); u.display_name = name; db.users[userId] = u; save(); }
  invalidateUserSessions(userId);
  emitToAdmins(u, "user", {});
  return Response.json({ success: true, user: { id: u.id, display_name: name } });
}
