import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "../design-system/bungalow-79d923";
import { EntitySheet } from "../entities/EntitySheet";
import { useI18n } from "../i18n/i18n";
import { mediaHost } from "./host";

interface MediaPickerDialogProps {
  label: string;
  hint?: string;
  kinds?: readonly string[];
  value: string | null;
  onChange: (mediaId: string | null) => void;
  imageOnly?: boolean;
  canClear?: boolean;
}

/** Opens the host's media library picker in a sheet from any media field. */
export function MediaPickerDialog({ label, hint, kinds = [], value, onChange, imageOnly = false, canClear = true }: MediaPickerDialogProps) {
  const { t } = useI18n();
  const host = mediaHost();
  const images = host.useImages().data ?? [];
  const image = images.find((item) => item.id === value);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape, true);
    return () => document.removeEventListener("keydown", closeOnEscape, true);
  }, [open]);

  if (imageOnly ? !host.ImagePicker : !host.MediaPicker) return null;

  const select = (mediaId: string | null) => {
    onChange(mediaId);
    setOpen(false);
  };

  return (
    <div className="bungalow-field">
      <span className="bungalow-label">{label}</span>
      <div className="stack">
        {image?.src ? <img src={image.src} alt={image.name} width={64} height={64} style={{ objectFit: "cover" }} /> : null}
        <div className="form-actions">
          <Button
            type="button"
            variant="outline"
            aria-label={`${label}: ${value ? image?.name ?? value : t("covers.none")}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={() => setOpen(true)}
          >
            {value ? image?.name ?? value : t("covers.none")} · {t("covers.choose")}
          </Button>
          {value && canClear ? (
            <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
              {t("covers.clear")}
            </Button>
          ) : null}
        </div>
      </div>
      {hint ? <p className="bungalow-help">{hint}</p> : null}
      {open
        ? createPortal(
            <EntitySheet title={label} ariaLabel={label} closeLabel={t("sheet.close")} onClose={() => setOpen(false)}>
              <div className="stack">
                {imageOnly && host.ImagePicker ? (
                  <host.ImagePicker value={value} onChange={(mediaId) => select(mediaId)} />
                ) : null}
                {!imageOnly && host.MediaPicker ? (
                  <host.MediaPicker label={label} hint={hint} kinds={kinds} value={value} onChange={select} />
                ) : null}
              </div>
            </EntitySheet>,
            document.body,
          )
        : null}
    </div>
  );
}
