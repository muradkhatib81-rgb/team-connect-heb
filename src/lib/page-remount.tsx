import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useState,
  type ReactNode,
} from "react";

const PageRemountContext = createContext(0);

let bumpRemount: () => void = () => {};

/** Remount the authenticated page outlet (not the shell / session tree). */
export function bumpPageRemount(): void {
  bumpRemount();
}

export function PageRemountProvider({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);

  useLayoutEffect(() => {
    bumpRemount = () => setGeneration((n) => n + 1);
    return () => {
      bumpRemount = () => {};
    };
  }, []);

  return <PageRemountContext.Provider value={generation}>{children}</PageRemountContext.Provider>;
}

export function PageRemountBoundary({ children }: { children: ReactNode }) {
  const generation = useContext(PageRemountContext);
  return <Fragment key={generation}>{children}</Fragment>;
}
