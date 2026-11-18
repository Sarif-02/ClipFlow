import { db } from "@/lib/clips/db";
import { ClipError } from "@/lib/clips/http";
import { validId } from "./drafts";
import { limits } from "./model";
import { fieldsFor, placeholders, templateKinds, type Template, type TemplateKind } from "./templates";

export async function listTemplates() {
  const rows = await db().contentTemplate.findMany({ orderBy: [{ isDefault: "desc" }, { name: "asc" }, { id: "asc" }] });
  return rows.map(({ id, name, kind, values, isDefault, revision }) => ({ id, name, kind, values, isDefault, revision }) as Template);
}

const invalid = (message: string) => new ClipError(400, message);
function block(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw invalid("Enter valid template values.");
  return value as Record<string, unknown>;
}
function parseText(value: unknown, max: number) {
  if (typeof value !== "string" || value.length > max) throw invalid(`Template text must fit within ${max} characters.`);
  const stripped = value.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key) => {
    if (!placeholders.some(item => item === key)) throw invalid(`Unsupported placeholder {{${key}}}.`);
    return "";
  });
  if (stripped.includes("{{") || stripped.includes("}}")) throw invalid("Use double braces around a supported placeholder name.");
  return value.trim();
}

export async function changeTemplate(input: unknown) {
  const data = block(input);
  const id = data.id;
  if (data.action === "delete" || data.action === "duplicate") {
    if (!validId(id)) throw invalid("Choose a template.");
    return db().$transaction(async tx => {
      const existing = await tx.contentTemplate.findUnique({ where: { id } });
      if (!existing) throw new ClipError(404, "Template was removed.");
      if (data.action === "duplicate") {
        const { name, values, kind } = existing;
        const copy = await tx.contentTemplate.create({ data: { name: `${name.slice(0, 95)} copy`, kind, values: values as Template["values"] } });
        return { id: copy.id };
      }
      const linked = await tx.contentTemplate.findMany({ where: { kind: "PRESET", id: { not: id } }, select: { values: true } });
      if (linked.some(row => (row.values as Template["values"]).templateId === id)) throw new ClipError(409, "Remove this template from its publishing presets first.");
      await tx.contentTemplate.delete({ where: { id } });
      return {};
    });
  }
  if (data.action !== "save" || typeof data.name !== "string" || !data.name.trim() || data.name.length > 100 ||
      typeof data.kind !== "string" || !Object.hasOwn(templateKinds, data.kind) || (id !== undefined && !validId(id))) {
    throw invalid("Enter a name and select a template type.");
  }
  const kind = data.kind as TemplateKind;
  const raw = block(data.values);
  const incoming = block(raw.content ?? {});
  const values: Template["values"] = { content: {} };
  for (const field of fieldsFor[kind]) {
    if (incoming[field] !== undefined) {
      const result = parseText(incoming[field], Math.max(limits[field], 240));
      if (result) values.content![field] = result;
    }
  }
  if (kind === "PRESET") {
    if (incoming.visibility !== undefined && incoming.visibility !== "") {
      if (typeof incoming.visibility !== "string" || !["private", "unlisted", "public"].includes(incoming.visibility)) throw invalid("Choose a supported visibility.");
      values.content!.visibility = incoming.visibility;
    }
    if (incoming.audience !== undefined && incoming.audience !== "") {
      if (typeof incoming.audience !== "string" || !["general", "kids"].includes(incoming.audience)) throw invalid("Choose a supported audience.");
      values.content!.audience = incoming.audience;
    }
    if (incoming.category) {
      if (typeof incoming.category !== "string" || !/^\d{1,4}$/.test(incoming.category)) throw invalid("Enter a YouTube category ID.");
      values.content!.category = incoming.category;
    }
    if (raw.interval !== undefined && raw.interval !== 0) {
      if (typeof raw.interval !== "number" || !Number.isInteger(raw.interval) || raw.interval < 1 || raw.interval > 10080) throw invalid("Use a posting interval between 1 and 10080 minutes.");
      values.interval = raw.interval;
    }
    if (raw.groupId) { if (!validId(raw.groupId)) throw invalid("Choose an account group."); values.groupId = raw.groupId; }
    if (raw.templateId) { if (!validId(raw.templateId)) throw invalid("Choose a content template."); values.templateId = raw.templateId; }
  }
  if ((kind === "AI" || kind === "PRESET") && raw.instructions !== undefined) values.instructions = parseText(raw.instructions, 2000);
  if (!Object.keys(values.content!).length && !values.instructions && !values.groupId && !values.templateId && !values.interval) throw invalid("Enter content or choose at least one preset preference.");

  return db().$transaction(async tx => {
    if (values.groupId && !(await tx.accountGroup.count({ where: { id: values.groupId } }))) throw new ClipError(409, "The selected group was removed.");
    if (values.templateId && !(await tx.contentTemplate.count({ where: { id: values.templateId, kind: { not: "PRESET" } } }))) throw new ClipError(409, "The selected content template was removed.");
    const record = { name: (data.name as string).trim(), kind, values, isDefault: data.isDefault === true };
    if (validId(id)) {
      const result = await tx.contentTemplate.updateMany({ where: { id, kind, revision: Number(data.revision) }, data: { ...record, revision: { increment: 1 } } });
      if (!result.count) throw new ClipError(409, "The template changed. Reopen it and try again.");
    }
    const savedId = validId(id) ? id : (await tx.contentTemplate.create({ data: record })).id;
    if (record.isDefault) await tx.contentTemplate.updateMany({ where: { id: { not: savedId }, kind, isDefault: true },
      data: { isDefault: false, revision: { increment: 1 } } });
    return { id: savedId };
  });
}
