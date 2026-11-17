import { useState, type ReactElement, type ReactNode } from "react";
import { PageMemoryContext, type PageMemoryValue } from "./usePageMemory";

/**
 * Keeps small bits of page state (a tab, an open row, a choice) while another page is showing,
 * since only one page is mounted at a time. Nothing redraws when a value is kept: a page reads
 * its values once, when it opens.
 * @param props - Component props.
 * @param props.children - app content
 * @returns the provider element
 */
export function PageMemoryProvider({ children }: { children: ReactNode }): ReactElement {
  const [value] = useState<PageMemoryValue>(() => {
    const kept = new Map<string, unknown>();
    return { has: kept.has.bind(kept), read: kept.get.bind(kept), write: kept.set.bind(kept) };
  });
  return <PageMemoryContext.Provider value={value}>{children}</PageMemoryContext.Provider>;
}
