import { Outlet } from "@tanstack/react-router";
import {
  createContext,
  Fragment,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

const PageRemountContext = createContext(0);

let bumpRemount: () => void = () => {};

/** Remount the authenticated page outlet (not the shell / session tree). */
export function bumpPageRemount(): void {
  bumpRemount();
}

export function usePageRemountGeneration(): number {
  return useContext(PageRemountContext);
}

export function PageRemountProvider({ children }: { children: ReactNode }) {
  const [generation, setGeneration] = useState(0);
  const setGenerationRef = useRef(setGeneration);
  setGenerationRef.current = setGeneration;

  // Assign during render so a refresh click is never a no-op while this
  // provider is mounted (useLayoutEffect would leave a gap on first paint).
  bumpRemount = () => setGenerationRef.current((n) => n + 1);

  useLayoutEffect(() => {
    bumpRemount = () => setGenerationRef.current((n) => n + 1);
    return () => {
      bumpRemount = () => {};
    };
  }, []);

  return <PageRemountContext.Provider value={generation}>{children}</PageRemountContext.Provider>;
}

export function PageRemountBoundary({ children }: { children: ReactNode }) {
  const generation = usePageRemountGeneration();
  return <Fragment key={generation}>{children}</Fragment>;
}

/**
 * Router outlet keyed by the remount generation. Use this at every layout
 * that renders an `<Outlet />` under the shell — nested platform routes
 * have their own outlet, and remounting only the authenticated parent
 * does not reset that leaf.
 */
export function RemountingOutlet() {
  const generation = usePageRemountGeneration();
  return <Outlet key={generation} />;
}
