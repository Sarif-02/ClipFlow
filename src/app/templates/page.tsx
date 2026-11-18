import { Suspense } from "react";
import { connection } from "next/server";
import { TemplatesBoard } from "@/components/planning/templates-board";
import { WorkspaceLoading } from "@/components/ui/workspace-loading";
import { db } from "@/lib/clips/db";
import { validId } from "@/lib/planning/drafts";
import { listTemplates } from "@/lib/planning/template-store";
import { templateFields, type Template } from "@/lib/planning/templates";
import type { Content } from "@/lib/planning/model";

export const metadata = { title: "Templates" };

async function TemplateData({ searchParams }: { searchParams: PageProps<"/templates">["searchParams"] }) {
  await connection();
  const { history } = await searchParams;
  const [templates, groups, drafts, record] = await Promise.all([listTemplates(),
    db().accountGroup.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db().publishingDraft.findMany({ where: { status: "ACTIVE" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
    validId(history) ? db().publicationHistory.findUnique({ where: { id: history }, include: { target: { select: { content: true } } } }) : null]);
  const stored = record?.target?.content as Partial<Content> | undefined;
  const content = Object.fromEntries(templateFields.flatMap(field => stored?.[field] ? [[field, stored[field]]] : []));
  if (record?.title && !Object.keys(content).length) content[record.platform === "INSTAGRAM" ? "caption" : "title"] = record.title;
  const seed: Template | null = record ? { id: "", kind: "PRESET", name: record.filename.slice(0, 100), isDefault: false, revision: 0, values: { content } } : null;
  return <TemplatesBoard key={record?.id ?? "templates"} templates={templates} groups={groups} drafts={drafts} seed={seed} />;
}

export default function Page({ searchParams }: PageProps<"/templates">) {
  return <Suspense fallback={<WorkspaceLoading />}><TemplateData searchParams={searchParams} /></Suspense>;
}
