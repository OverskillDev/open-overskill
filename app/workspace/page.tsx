import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";

export const metadata: Metadata = {
  title: "Your workspace — Open Overskill",
  description: "Build software with words. Create, edit and return to your apps in Open Overskill.",
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <Workspace />;
}
