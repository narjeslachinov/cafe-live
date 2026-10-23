import { redirect } from "next/navigation";
import { getSession } from "@/server/auth";

export default async function Home() {
  const s = await getSession();
  if (!s) redirect("/login");
  redirect(s.role === "kitchen" ? "/kitchen" : "/tables");
}