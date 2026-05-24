import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  rulesProfiles,
  wbAccountRules,
  wbAccounts,
} from "@/lib/db/schema";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { requireUser } from "@/lib/auth/require-user";
import { RulesForm } from "./rules-form";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function AccountRulesPage({ params }: PageProps) {
  const { userId } = await requireUser();
  const { id } = await params;

  const [row] = await db
    .select({
      accountName: wbAccounts.name,
      profileId: rulesProfiles.id,
      profileName: rulesProfiles.name,
      isPreset: rulesProfiles.isPreset,
      minViews: rulesProfiles.minViews,
      minCtr: rulesProfiles.minCtr,
      weakCampaignCtr: rulesProfiles.weakCampaignCtr,
      minCartsToProtect: rulesProfiles.minCartsToProtect,
      topKeepPct: rulesProfiles.topKeepPct,
      minClustersAlive: rulesProfiles.minClustersAlive,
      bannedKeywords: rulesProfiles.bannedKeywords,
      useDynamicCtr: rulesProfiles.useDynamicCtr,
      minDynamicCtr: rulesProfiles.minDynamicCtr,
    })
    .from(wbAccounts)
    .innerJoin(wbAccountRules, eq(wbAccountRules.wbAccountId, wbAccounts.id))
    .innerJoin(rulesProfiles, eq(rulesProfiles.id, wbAccountRules.rulesProfileId))
    .where(and(eq(wbAccounts.id, id), eq(wbAccounts.userId, userId)))
    .limit(1);

  if (!row) notFound();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <h1 className="text-2xl font-semibold">Правила чистки</h1>
        <p className="text-sm text-muted-foreground">
          Аккаунт: <b>{row.accountName}</b>. Эти правила определяют, какие
          поисковые фразы воркер заминусует. Менять можно как угодно — пресеты
          не пострадают, ты редактируешь свою копию.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Параметры</CardTitle>
          <CardDescription>
            Сильно не понимаешь что менять — начни с «Минимальный CTR» (выше =
            строже к фразам) и банлиста.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <RulesForm
            accountId={id}
            profileName={row.profileName}
            isPreset={row.isPreset}
            initial={{
              minViews: row.minViews,
              minCtr: row.minCtr,
              weakCampaignCtr: row.weakCampaignCtr,
              minCartsToProtect: row.minCartsToProtect,
              topKeepPct: row.topKeepPct,
              minClustersAlive: row.minClustersAlive,
              bannedKeywords: row.bannedKeywords ?? [],
              useDynamicCtr: row.useDynamicCtr,
              minDynamicCtr: row.minDynamicCtr,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
