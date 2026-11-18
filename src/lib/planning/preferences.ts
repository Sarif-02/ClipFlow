import { defaultTimezone } from "./model";

export function postingTimezone() {
  const configured = process.env.APP_TIMEZONE?.trim() || defaultTimezone;
  try { new Intl.DateTimeFormat("en", { timeZone: configured }); return configured; }
  catch { return defaultTimezone; }
}
