export const setSessionCookie = (token: string, maxAgeSec = 60*60*8) => ({
  'Set-Cookie': `sid=${encodeURIComponent(token)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${maxAgeSec}`
});
