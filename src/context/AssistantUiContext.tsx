import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

interface AssistantUiValue {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

const AssistantUiContext = createContext<AssistantUiValue | undefined>(undefined);

export function AssistantUiProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const toggle = useCallback(() => setOpen((v) => !v), []);
  const value = useMemo(() => ({ open, setOpen, toggle }), [open, toggle]);
  return <AssistantUiContext value={value}>{children}</AssistantUiContext>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAssistantUi(): AssistantUiValue {
  const ctx = useContext(AssistantUiContext);
  if (!ctx) {
    throw new Error("useAssistantUi must be used within AssistantUiProvider");
  }
  return ctx;
}
