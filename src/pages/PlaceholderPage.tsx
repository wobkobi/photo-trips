import { EmptyState, PageHeader } from "../components/ui";

/**
 * Stand-in for a page that hasn't been built yet.
 * @param props.title - page title
 * @returns the placeholder page
 */
export function PlaceholderPage({ title }: { title: string }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState title="Coming soon">This part of Photo Trips isn't built yet.</EmptyState>
    </>
  );
}
