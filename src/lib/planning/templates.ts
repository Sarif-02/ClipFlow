import type { Content } from "./model";

export const templateKinds = {
  TITLE: "YouTube title", DESCRIPTION: "YouTube description", TAGS: "YouTube tags",
  CAPTION: "Instagram caption", HASHTAGS: "Instagram hashtags", AI: "AI instructions", PRESET: "Publishing preset",
} as const;
export type TemplateKind = keyof typeof templateKinds;
export type TemplateField = "title" | "description" | "tags" | "caption" | "hashtags";
export const templateFields: TemplateField[] = ["title", "description", "tags", "caption", "hashtags"];
export const fieldsFor: Record<TemplateKind, TemplateField[]> = {
  TITLE: ["title"], DESCRIPTION: ["description"], TAGS: ["tags"], CAPTION: ["caption"], HASHTAGS: ["hashtags"], AI: [], PRESET: templateFields,
};
export const placeholders = ["clip_name", "source_title", "channel_name", "platform", "context", "date"] as const;
export type Template = {
  id: string; name: string; kind: TemplateKind; isDefault: boolean; revision: number;
  values: { content?: Partial<Content>; instructions?: string; groupId?: string; templateId?: string; interval?: number };
};
export function renderTemplate(value: string, context: Record<typeof placeholders[number], string>) {
  return value.replace(/{{\s*([a-z_]+)\s*}}/g, (_, key: keyof typeof context) => context[key] ?? "");
}
