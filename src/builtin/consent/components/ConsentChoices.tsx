import { Checkbox } from "../../../design-system/bungalow-79d923";
import { getLocalizedText } from "../../../apps/types";
import { useI18n } from "../../../i18n/i18n";
import { NECESSARY, consentCategories, servicesInCategory } from "../models";

/** A switch per consent category with its description; `necessary` is shown on and locked. */
export function ConsentChoices({ value, onChange }: { value: Record<string, boolean>; onChange: (next: Record<string, boolean>) => void }) {
  const { locale } = useI18n();
  return (
    <ul className="consent-choices">
      {consentCategories().map((category) => {
        const necessary = category.id === NECESSARY.id;
        const services = [...new Set([...(category.services ?? []), ...servicesInCategory(category.id).map((s) => s.name)])];
        return (
          <li key={category.id} className="consent-choices__item">
            <Checkbox
              label={getLocalizedText(category.label, locale)}
              checked={necessary || value[category.id] === true}
              disabled={necessary}
              onChange={(event) => onChange({ ...value, [category.id]: event.target.checked })}
            />
            <p className="consent-choices__description">
              {getLocalizedText(category.description, locale)}
            </p>
            {services.length ? <p className="consent-choices__services">{services.join(", ")}</p> : null}
          </li>
        );
      })}
    </ul>
  );
}
