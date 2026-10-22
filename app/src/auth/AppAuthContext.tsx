import { createContext, useContext, type ReactNode } from 'react';

/** Must match the server local user in auth.middleware.ts */
export const LOCAL_USER_ID = 'local-dev-user';

export interface AppAuth {
  userId: string;
}

const appAuth: AppAuth = {
  userId: LOCAL_USER_ID,
};

const AppAuthContext = createContext<AppAuth>(appAuth);

export function AppAuthProvider({ children }: { children: ReactNode }) {
  return <AppAuthContext.Provider value={appAuth}>{children}</AppAuthContext.Provider>;
}

export function useAppAuth(): AppAuth {
  return useContext(AppAuthContext);
}
