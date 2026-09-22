import { EmptyState } from "@/components/EmptyState";
export default function NotFound() { return <EmptyState title="Not found" body="That game or page isn’t in the current data set." action={{ href: "/", label: "Back to the board" }} />; }
