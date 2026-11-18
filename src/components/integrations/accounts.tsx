"use client";

import Link from "next/link";
import { InstagramLogoIcon, YoutubeLogoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { Status } from "@/components/ui/status";
import { displayTime, platformName, platforms, type Platform } from "@/lib/planning/model";
import { planningRequest } from "@/components/planning/draft-actions";
import { connectAccount } from "./setup";

type Account = { id: string; name: string; platform: Platform; remoteId: string; avatar: string | null;
  status: string; canPublish: boolean; canAnalyze: boolean; verifiedAt: string | null; queued: number;
  expiresAt: string | null; refreshedAt: string | null; lastApiAt: string | null; issue: string | null };
type Group = { id: string; name: string; ids: string[] };

export function Accounts({ accounts, groups, notice, stats, timezone, googleMode }: { accounts: Account[]; groups: Group[]; notice: string;
  stats: Record<string, string>; timezone: string; googleMode?: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [disconnect, setDisconnect] = useState<Account>();
  const [group, setGroup] = useState<Group>();
  const [removeGroup, setRemoveGroup] = useState<Group>();
  async function action(input: object, success: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await planningRequest("/api/accounts", "POST", input);
      setMessage(result.verified === false ? "The account is missing one or more permissions." : success);
      setDisconnect(undefined); setGroup(undefined); setRemoveGroup(undefined); router.refresh();
    } catch (problem) { setError(problem instanceof Error ? problem.message : "Account update failed."); }
    finally { setBusy(false); }
  }
  return <div className="overview">
    <header className="overview-header"><div><h1 className="heading-4">Accounts</h1><p className="body-6 muted">Manage publishing destinations and reusable groups.</p></div>
      <Link className={buttonVariants({ variant: "primary" })} href="/integrations">Open Integrations</Link></header>
    {(notice || message) && <p className="availability body-6" role="status">{message || notice}</p>}
    {!disconnect && !group && !removeGroup && error && <p role="alert" className="form-error body-6">{error}</p>}
    {platforms.map(platform => <Card key={platform} className="overview-panel plan-stack">
      <h2 className="dashboard-section plan-avatar">{platform === "YOUTUBE" ? <YoutubeLogoIcon className="platform-youtube" size={20} aria-hidden="true" /> :
        <InstagramLogoIcon className="platform-instagram" size={20} aria-hidden="true" />}{platformName[platform]}</h2>
      {platform === "YOUTUBE" && accounts.some(account => account.platform === platform) && googleMode !== "production" &&
        <p className="caption-2 tone-warning">{googleMode === "testing" ? "Google OAuth is marked as Testing. " : "If your Google OAuth app is in External Testing, "}
          {googleMode === "testing" ? "Refresh tokens" : "refresh tokens"} for these scopes generally expire after seven days. Set the mode in Integrations.</p>}
      {accounts.some(account => account.platform === platform) ? <ul className="plan-list">{accounts.filter(account => account.platform === platform).map(account => (
        <li className="plan-row" key={account.id}>
          <div className="plan-avatar">
            {account.avatar && /^https:\/\/(?:[\w.-]+\.)?(?:ytimg\.com|ggpht\.com|googleusercontent\.com|fbcdn\.net|cdninstagram\.com)\//.test(account.avatar) && (
              // eslint-disable-next-line @next/next/no-img-element
              <img className="analytics-image" src={account.avatar} alt="" referrerPolicy="no-referrer" />
            )}
            <div><p className="title-4">{account.name}</p><p className="caption-5 technical muted">{account.remoteId}</p>
              <Status state={account.status}>{account.status === "CONNECTED" ? "Connected" : account.status === "DISCONNECTED" ? "Disconnected" : "Reconnect required"}</Status>
              <p className="caption-5 muted">Publishing {account.canPublish ? "granted" : "unavailable"}
                {platform === "YOUTUBE" && ` · Analytics ${account.canAnalyze ? "granted" : "unavailable"}`}</p>
              {account.issue && <p className="caption-5 tone-warning">{account.issue}</p>}
              <details><summary className="caption-1">Connection details</summary><dl className="plan-stack caption-5 muted settings-note">
                {[["Access token expiry", account.expiresAt], ["Last token refresh", account.refreshedAt], ["Last successful API request", account.lastApiAt], ["Last verified", account.verifiedAt]].map(([label, value]) =>
                  <div key={label}><dt>{label}</dt><dd className="technical">{value ? displayTime(value, timezone) : "Unavailable"}</dd></div>)}
              </dl></details>
              {stats[account.id] && <p className="caption-5 muted">{stats[account.id]}</p>}
            </div>
          </div>
          <div className="plan-actions">
            <Button disabled={busy || account.status !== "CONNECTED"} onClick={() => void action({ action: "verify", id: account.id }, "Account verified.")}>Verify</Button>
            <Button disabled={busy} onClick={async () => {
              setError("");
              try { await connectAccount(account.platform, account.id); }
              catch (problem) { setError(problem instanceof Error ? problem.message : "Could not start authorization."); }
            }}>Reconnect</Button>
            {account.status !== "DISCONNECTED" && <Button className="tone-error" disabled={busy} onClick={() => { setError(""); setDisconnect(account); }}>Disconnect</Button>}
          </div>
        </li>
      ))}</ul> : <p className="chart-empty body-6 muted">No {platformName[platform]} accounts connected.</p>}
    </Card>)}
    <Card className="overview-panel plan-stack">
      <div className="plan-row"><h2 className="dashboard-section">Account groups</h2>
        <Button disabled={!accounts.length || busy} onClick={() => { setError(""); setGroup({ id: "", name: "", ids: [] }); }}>New group</Button></div>
      <p className="body-6 muted">Changing a group does not change destinations in confirmed posts.</p>
      <ul className="plan-list">{groups.map(item => <li className="plan-row" key={item.id}><span className="title-4">{item.name} · {item.ids.length} accounts</span>
        <div className="plan-actions"><Button onClick={() => { setError(""); setGroup(item); }}>Edit group</Button>
          <Button onClick={() => { setError(""); setRemoveGroup(item); }}>Delete group</Button></div></li>)}</ul>
    </Card>
    {disconnect && <Modal open busy={busy} onOpenChange={open => { if (!open) setDisconnect(undefined); }} title={`Disconnect ${disconnect.name}?`}
      description={`This removes local credentials and cached analytics. ${disconnect.queued} pending jobs may need to be resumed manually after reconnecting. History and media stay saved.`}>
      {error && <p role="alert" className="clip-dialog-body body-6 form-error">{error}</p>}
      <div className="clip-dialog-footer"><Button disabled={busy} onClick={() => setDisconnect(undefined)}>Keep account</Button>
        <Button disabled={busy} variant="primary" onClick={() => void action({ action: "disconnect", id: disconnect.id }, "Account disconnected.")}>Confirm disconnect</Button></div>
    </Modal>}
    {removeGroup && <Modal open busy={busy} onOpenChange={open => { if (!open) setRemoveGroup(undefined); }} title="Delete account group?"
      description={`Remove ${removeGroup.name}. Accounts and published or queued destinations will stay saved.`}>
      {error && <p role="alert" className="clip-dialog-body body-6 form-error">{error}</p>}
      <div className="clip-dialog-footer"><Button disabled={busy} onClick={() => setRemoveGroup(undefined)}>Keep group</Button>
        <Button disabled={busy} variant="primary" onClick={() => void action({ action: "deleteGroup", groupId: removeGroup.id }, "Group deleted.")}>Confirm delete</Button></div>
    </Modal>}
    {group && <Modal open busy={busy} onOpenChange={open => { if (!open) setGroup(undefined); }} title={group.id ? "Edit account group" : "New account group"}
      description="Select YouTube or Instagram destinations for future drafts.">
      <form onSubmit={event => { event.preventDefault(); void action({ action: "group", groupId: group.id, name: group.name, ids: group.ids }, "Group saved."); }}>
        <div className="clip-dialog-body"><label className="clip-form-label title-4">Group name<input required maxLength={80} className="clip-field body-6"
          value={group.name} onChange={event => setGroup({ ...group, name: event.target.value })} /></label>
          {accounts.map(account => <label className="plan-check body-6" key={account.id}><input type="checkbox" checked={group.ids.includes(account.id)}
            onChange={event => setGroup({ ...group, ids: event.target.checked ? [...group.ids, account.id] : group.ids.filter(id => id !== account.id) })} />
            {account.name} · {platformName[account.platform]}</label>)}
          {error && <p role="alert" className="body-6 form-error">{error}</p>}
        </div>
        <div className="clip-dialog-footer"><Button disabled={busy || !group.ids.length} type="submit" variant="primary">Save group</Button></div>
      </form>
    </Modal>}
  </div>;
}
