import { isTrainingMode } from "@/lib/training";

/**
 * Names shown in the browser tab, the installed app and the web manifest.
 * Production values are unchanged; training mode marks every one of them.
 */
export function appIdentity() {
  if (!isTrainingMode()) {
    return {
      title: "The Kings Tribe — Finance & Operations",
      titleTemplate: "%s · The Kings Tribe",
      name: "The Kings Tribe — Finance & Operations",
      shortName: "TKT Operations",
    };
  }
  return {
    title: "Training · The Kings Tribe — Finance & Operations",
    titleTemplate: "Training · %s · The Kings Tribe",
    name: "The Kings Tribe — Training",
    shortName: "TKT Training",
  };
}
