// Keep a text selection inside the one copyable value it started in. The page is otherwise
// unselectable, so a triple-click or a drag past a value's end runs on to the next selectable
// text further down, and every line break in between is painted as selected.
import { useEffect, type RefObject } from "react";

/**
 * Pull the selection's moving end back inside the `.selectable` element its fixed end is in,
 * when the selection starts inside `area`. Setting a contained selection fires another
 * selectionchange, which then leaves it alone.
 * @param area - the part of the page whose values are contained
 */
function contain(area: HTMLElement): void {
  const selection = document.getSelection();
  if (!selection || selection.isCollapsed) return;
  const { anchorNode, anchorOffset, focusNode } = selection;
  if (!anchorNode || !focusNode || !area.contains(anchorNode)) return;
  const start = anchorNode instanceof Element ? anchorNode : anchorNode.parentElement;
  const host = start?.closest(".selectable");
  if (!host || !area.contains(host) || host.contains(focusNode)) return;
  const after = host.compareDocumentPosition(focusNode) & Node.DOCUMENT_POSITION_FOLLOWING;
  selection.setBaseAndExtent(anchorNode, anchorOffset, host, after ? host.childNodes.length : 0);
}

/**
 * Keep text selections that start in a `.selectable` element inside `area` within that element,
 * so each value there can be selected and copied on its own.
 * @param area - the part of the page whose values are contained
 */
export function useContainedSelection(area: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    /** Contain the selection after each change, while the area is on the page. */
    function onChange(): void {
      if (area.current) contain(area.current);
    }
    document.addEventListener("selectionchange", onChange);
    return () => document.removeEventListener("selectionchange", onChange);
  }, [area]);
}
