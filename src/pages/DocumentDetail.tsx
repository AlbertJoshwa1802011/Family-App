import { Download, Eye, FileText, Pencil, Trash2 } from "lucide-react";
import { useParams } from "react-router-dom";
import { AppBar } from "../components/ui/AppBar";
import { Page } from "../components/ui/Page";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ListItem } from "../components/ui/ListItem";

export function DocumentDetail() {
  const { id } = useParams();

  return (
    <>
      <AppBar title="Document" back />
      <Page className="space-y-5">
        <Card className="p-5">
          <div className="flex items-start gap-4">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-vault-500/10 text-vault-300">
              <FileText className="size-6" aria-hidden="true" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-white">
                Document {id}
              </h2>
              <p className="text-sm text-fg-muted">Details arrive in Phase 2</p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button variant="secondary" leadingIcon={<Eye className="size-4" />}>
              View
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<Download className="size-4" />}
            >
              Download
            </Button>
            <Button
              variant="secondary"
              leadingIcon={<Pencil className="size-4" />}
            >
              Edit
            </Button>
            <Button variant="danger" leadingIcon={<Trash2 className="size-4" />}>
              Delete
            </Button>
          </div>
        </Card>

        <Card className="divide-y divide-line overflow-hidden">
          <ListItem title="Category" trailing={<span className="text-sm text-fg-muted">—</span>} />
          <ListItem title="Expiry date" trailing={<span className="text-sm text-fg-muted">—</span>} />
          <ListItem title="Belongs to" trailing={<span className="text-sm text-fg-muted">—</span>} />
          <ListItem title="Files & versions" trailing={<span className="text-sm text-fg-muted">—</span>} />
        </Card>
      </Page>
    </>
  );
}
