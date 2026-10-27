import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Church, HandCoins } from "lucide-react";
import { AppBar } from "../../components/ui/AppBar";
import { Page } from "../../components/ui/Page";
import { Card } from "../../components/ui/Card";
import { EmptyState } from "../../components/ui/EmptyState";
import { LiquidPillTabs } from "../../components/ui/LiquidPillTabs";
import { MoneySubNav } from "../../components/money/MoneySubNav";
import { useAuth } from "../../context/AuthContext";
import { api } from "../../lib/api";
import { HandSettlementsPanel } from "./HandSettlements";
import { ChurchSettlementsPanel } from "./ChurchSettlements";

interface LocalFund {
  id: string;
  name: string;
}

export function Funds() {
  const { activeFamilyId, user } = useAuth();
  const [view, setView] = useState<"church" | "hand">("church");

  const localQ = useQuery({
    queryKey: ["funds", activeFamilyId],
    queryFn: () => api<{ funds: LocalFund[] }>(`/funds?familyId=${activeFamilyId}`),
    enabled: Boolean(activeFamilyId),
  });

  if (!activeFamilyId) {
    return (
      <>
        <AppBar title="Funds" />
        <Page width="list">
          <EmptyState
            icon={HandCoins}
            title="No family yet"
            description="You need a family before you can settle church funds."
          />
        </Page>
      </>
    );
  }

  return (
    <>
      <AppBar title="Funds" />
      <Page width="list" className="space-y-4 pb-24 md:pb-10">
        <MoneySubNav />

        <LiquidPillTabs
          ariaLabel="Fund settlement views"
          value={view}
          onChange={setView}
          items={[
            { id: "church", label: "Church", icon: Church },
            { id: "hand", label: "In hand", icon: HandCoins },
          ]}
        />

        {view === "hand" ? (
          <HandSettlementsPanel familyId={activeFamilyId} />
        ) : (
          <>
        <ChurchSettlementsPanel
          familyId={activeFamilyId}
          isPlatformAdmin={Boolean(user?.isPlatformAdmin)}
        />

        {(localQ.data?.funds.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h3 className="px-1 text-[13px] font-semibold text-fg-muted">
              Manual ledgers
            </h3>
            <Card className="divide-y divide-line overflow-hidden">
              {localQ.data!.funds.map((f) => (
                <Link
                  key={f.id}
                  to={`/money/funds/${f.id}`}
                  className="block px-4 py-3 text-sm text-fg hover:bg-white/5"
                >
                  {f.name}
                </Link>
              ))}
            </Card>
          </section>
        )}
          </>
        )}
      </Page>
    </>
  );
}
