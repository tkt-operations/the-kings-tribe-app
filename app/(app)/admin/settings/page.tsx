import { PageHeader } from "@/components/ui/page-header";
import { requirePagePermission } from "@/lib/auth";
import { getChurchSettings } from "@/lib/data/settings";
import { listTimezones } from "@/lib/timezones";
import { SettingsForm } from "./settings-form";

export const metadata = { title: "Church settings" };

export default async function SettingsPage() {
  await requirePagePermission("settings.manage");
  const settings = await getChurchSettings();
  if (!settings) return null;
  return (
    <>
      <PageHeader eyebrow="Administration" title="Church settings" description="Nothing about the church is hard-coded — everything shown to requesters comes from here." />
      <SettingsForm settings={settings} timezones={listTimezones(settings.timezone)} />
    </>
  );
}
