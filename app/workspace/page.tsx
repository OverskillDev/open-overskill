import type { Metadata } from "next";
import { Workspace } from "@/components/workspace/Workspace";
import { builderConfig } from "@/lib/builder-config";

export const metadata: Metadata = {
  title: "Your workspace",
  description: `${builderConfig.description} Create, edit and return to your apps in ${builderConfig.name}.`,
  robots: { index: false, follow: false },
};

export default function WorkspacePage() {
  return <Workspace />;
}
