import type { ReactNode } from "react";
import { Button } from "../design-system/bungalow-79d923";
import { useSiteOffers } from "../sites/capabilities";

interface FormActionsProps {
  onCancel?: () => void;
  cancelLabel?: ReactNode;
  onDelete?: () => void;
  deleteLabel?: ReactNode;
  deleting?: boolean;
  submitLabel: ReactNode;
  saving?: boolean;
  submitDisabled?: boolean;
}

/** Footer bar for create/update forms: destructive/secondary actions on the left, the primary save action on the right. */
export function FormActions({
  onCancel,
  cancelLabel,
  onDelete,
  deleteLabel,
  deleting,
  submitLabel,
  saving,
  submitDisabled,
}: FormActionsProps) {
  // A site that doesn't offer deleting (its aspects, sites/capabilities.ts) leaves the button out.
  const offers = useSiteOffers();
  const canDelete = !!onDelete && offers({ aspects: ["delete"] });
  return (
    <div className="form-actions">
      <div className="form-actions__secondary">
        {canDelete ? (
          <Button type="button" variant="outline" tone="danger" onClick={onDelete} loading={deleting}>
            {deleteLabel}
          </Button>
        ) : null}
        {onCancel ? (
          <Button type="button" variant="outline" tone="default" onClick={onCancel}>
            {cancelLabel}
          </Button>
        ) : null}
      </div>
      <Button type="submit" tone="primary" loading={saving} disabled={submitDisabled}>
        {submitLabel}
      </Button>
    </div>
  );
}
