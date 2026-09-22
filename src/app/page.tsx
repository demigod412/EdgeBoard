import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { isSport } from "@/lib/sports";
export default async function Root() {
  const c = (await cookies()).get("eb_sport")?.value ?? "";
  redirect(`/${isSport(c) ? c : "basketball"}`);
}
