import { AppBar } from "../components/ui/AppBar";
import { AssistantThread } from "../components/AssistantThread";

export function Assistant() {
  return (
    <>
      <AppBar title="Assistant" back />
      <div className="mx-auto flex h-[calc(100dvh-8rem)] max-w-md flex-col px-4">
        <AssistantThread />
      </div>
    </>
  );
}
