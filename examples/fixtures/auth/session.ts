interface Session {
  expired: boolean;
}

declare const sessionStore: {
  read(token: string): Promise<Session>;
  replace(session: Session): Promise<Session>;
};

declare function refreshSession(token: string): Promise<Session>;

export async function resolveSession(token: string): Promise<Session> {
  const current = await sessionStore.read(token);
  if (current.expired) return sessionStore.replace(await refreshSession(token));
  return current;
}
