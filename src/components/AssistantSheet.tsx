import { AssistantThread } from "./AssistantThread";
import { Sheet } from "./ui/Sheet";
import { useAssistantUi } from "../context/AssistantUiContext";

export function AssistantSheet() {
  const { open, setOpen } = useAssistantUi();

  return (
    <Sheet
      open={open}
      onClose={() => setOpen(false)}
      title="Assistant"
      className="h-[min(78dvh,640px)]"
    >
      <AssistantThread compact onNavigate={() => setOpen(false)} />
    </Sheet>
  );
}
