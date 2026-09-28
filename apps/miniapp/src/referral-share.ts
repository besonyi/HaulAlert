/** Builds the official Telegram share URL only from a safe, public bot invite link. */
export function telegramReferralShareUrl(inviteLink: string): string {
  const invite = new URL(inviteLink);
  if (invite.protocol !== "https:" || invite.hostname !== "t.me") {
    throw new Error("Referral link must be a secure Telegram link.");
  }
  const share = new URL("https://t.me/share/url");
  share.searchParams.set("url", invite.href);
  share.searchParams.set("text", "Get new vehicle load alerts with HaulAlert.");
  return share.href;
}
