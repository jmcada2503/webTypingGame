/** The match id in an Invite link's address (`#/m/<id>`), or null when the address is not one. */
export function inviteCodeFromHash(hash: string): string | null {
  return /^#\/m\/([a-z0-9]{3,32})$/.exec(hash)?.[1] ?? null;
}
