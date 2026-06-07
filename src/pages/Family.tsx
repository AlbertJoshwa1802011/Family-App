import { UserPlus, Users } from "lucide-react";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { EmptyState } from "../components/ui/EmptyState";
import { Button } from "../components/ui/Button";

export function FamilyPage() {
  return (
    <>
      <AppBar
        title="Family"
        trailing={
          <Button size="md" leadingIcon={<UserPlus className="size-4" />}>
            Invite
          </Button>
        }
      />
      <Page>
        <EmptyState
          icon={Users}
          title="Build your family circle"
          description="Invite family members so everyone can access shared documents and stay on top of renewals together."
          action={
            <Button leadingIcon={<UserPlus className="size-4" />}>
              Invite a member
            </Button>
          }
        />
      </Page>
    </>
  );
}
