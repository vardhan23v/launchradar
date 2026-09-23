import { redirect } from "next/navigation";

/** The dashboard first shipped at /v3 and is now the home page; old links still work. */
export default function V3() {
  redirect("/");
}
