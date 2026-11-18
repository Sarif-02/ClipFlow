"use client";

import { blankContent, limits, type Content, type Platform } from "@/lib/planning/model";

const fieldLabels: Record<keyof Content, string> = {
  title: "YouTube title", description: "YouTube description", tags: "YouTube tags", visibility: "Visibility",
  category: "YouTube category", audience: "YouTube audience", synthetic: "Altered or synthetic content",
  caption: "Instagram caption", hashtags: "Instagram hashtags",
};
export const fieldsByPlatform: Record<Platform, (keyof Content)[]> = {
  YOUTUBE: ["title", "audience", "visibility", "description", "tags", "category", "synthetic"],
  INSTAGRAM: ["caption", "hashtags"],
};
const options: Partial<Record<keyof Content, [string, string][]>> = {
  visibility: [["private", "Private"], ["unlisted", "Unlisted"], ["public", "Public"]],
  audience: [["general", "Not made for kids"], ["kids", "Made for kids"]],
  synthetic: [["no", "No"], ["yes", "Yes"]],
  category: [["22", "People & Blogs"], ["24", "Entertainment"], ["27", "Education"], ["20", "Gaming"], ["10", "Music"],
    ["17", "Sports"], ["23", "Comedy"], ["28", "Science & Technology"], ["26", "Howto & Style"], ["25", "News & Politics"],
    ["1", "Film & Animation"], ["2", "Autos & Vehicles"], ["15", "Pets & Animals"], ["19", "Travel & Events"], ["29", "Nonprofits & Activism"]],
};
export function ContentFields({ platform, value, update, inherited, suggestedTitle, fields = fieldsByPlatform[platform] }: {
  platform: Platform; value: Partial<Content>; update: (key: keyof Content, value?: string) => void; inherited?: Content; suggestedTitle?: string;
  fields?: (keyof Content)[];
}) {
  return <div className="plan-fields">
    {fields.map(key => {
      const selected = value[key] || (key === "category" ? blankContent.category : "");
      const menu = options[key];
      const hint = inherited ? inherited[key] || (key === "category" ? blankContent.category : "No clip default") : undefined;
      return <div className="plan-stack" key={key}>
        <label className="clip-form-label title-4">{fieldLabels[key]}
          {menu ? <select className="clip-field body-6" value={inherited && value[key] === undefined ? "inherit" : selected}
            onChange={event => update(key, event.target.value === "inherit" ? undefined : event.target.value)}>
            {inherited && <option value="inherit">Use clip value: {menu.find(item => item[0] === hint)?.[1] ?? "Not set"}</option>}
            {key !== "visibility" && key !== "category" && <option value="">{key === "audience" ? "Choose an audience" : "Not set"}</option>}
            {menu.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
            {key === "category" && !menu.some(([id]) => id === selected) && <option value={selected}>Saved category {selected}</option>}
          </select> : ["description", "caption"].includes(key)
            ? <textarea className="clip-field body-6" rows={3} maxLength={limits[key]} value={selected} placeholder={hint}
              onChange={event => update(key, event.target.value)} />
            : <input className="clip-field body-6" maxLength={limits[key]} value={selected} placeholder={key === "title" ? inherited?.title || suggestedTitle : hint}
              inputMode={key === "category" ? "numeric" : undefined}
              onChange={event => update(key, key === "category" ? event.target.value.replace(/\D/g, "") : event.target.value)} />}
        </label>
        {key === "title" && suggestedTitle && <p className="caption-5 muted">Leave blank to use {inherited?.title ? "the clip title" : "the clip name"}.</p>}
        {inherited && !menu && value[key] !== undefined && <button type="button" className="workspace-link caption-5 plan-reset" onClick={() => update(key)}>Use clip value</button>}
      </div>;
    })}
  </div>;
}

export function ContentSummary({ content, platform }: { content: Content; platform: Platform }) {
  return <dl className="clip-facts">
    {fieldsByPlatform[platform].map(key => <div key={key}><dt className="caption-5 muted">{fieldLabels[key]}</dt>
      <dd className="body-6">{options[key]?.find(item => item[0] === content[key])?.[1] ?? (content[key] || "Not set")}</dd></div>)}
  </dl>;
}
