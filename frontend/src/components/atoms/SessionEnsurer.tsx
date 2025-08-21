import { SessionContext } from 'next-auth/react';
import { useContext } from 'react';
import { useUserStore } from '../../globalStates/user';

export const SessionEnsurer = ({ children }: { children: React.ReactNode }) => {
  const session = useContext(SessionContext);
  const setUser = useUserStore(({ setUser }) => setUser);

  if (session === undefined) {
    // TODO: Add a loading state
    return <div>Loading...</div>;
  }

  if (session.data === null) {
    setUser(null);
  }

  return <>{children}</>;
};
