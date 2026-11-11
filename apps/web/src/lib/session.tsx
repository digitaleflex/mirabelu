'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { UserDto } from '@mirabelu/contracts';
import { onSessionChange, refreshSession } from './api';

interface SessionState {
  user: UserDto | null;
  /** false tant que la session n'a pas été restaurée au chargement. */
  ready: boolean;
  isSubscriber: boolean;
}

const Ctx = createContext<SessionState>({ user: null, ready: false, isSubscriber: false });

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserDto | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const off = onSessionChange(setUser);
    void refreshSession().finally(() => setReady(true));
    return off;
  }, []);

  const isSubscriber = user !== null && (user.role === 'ADMIN' || (user.subscriptionEndsAt !== null && new Date(user.subscriptionEndsAt) > new Date()));
  return <Ctx.Provider value={{ user, ready, isSubscriber }}>{children}</Ctx.Provider>;
}

export const useSession = (): SessionState => useContext(Ctx);
