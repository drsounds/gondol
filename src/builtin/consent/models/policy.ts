import { getConsentConfig, hasConsent, onConsent, type ConsentController } from "./consent";
import { resolutionsOf } from "../../../apps/contributions";
import { privacyServicesHook, type PrivacyService, type PrivacyServiceStorage } from "../../../apps/shellHooks";
import { getInternalApp } from "../../../apps/registry";
import type { AppLocaleString } from "../../../apps/types";
import { namespaced } from "../../../shell/storage";

/**
 * The privacy policy (GDPR art. 13 information) in Swedish and English, as data the policy page
 * renders: sections of paragraphs and lists, the services table and the storage table. Services
 * come from the host (`configurePolicy({ services })`, by default the platform the app runs on) and
 * from every app's manifest (`services`), so an app that adds a third party lists it itself. A
 * draft: have it reviewed before relying on it. Unset controller details show as [placeholders].
 */

export type PolicyLocale = "sv" | "en";

export type { PrivacyService, PrivacyServiceStorage };

/** A service with the app that declared it (null for the host's own). */
export interface ListedService extends PrivacyService {
  appId: string | null;
  appName?: string;
}

/** Something kept in the user's browser, with the service and category it belongs to. */
export interface StorageItem extends PrivacyServiceStorage {
  provider: string;
  category: string;
}

const DPF_SCC: AppLocaleString = {
  sv: "Överföring till USA sker med stöd av EU:s och USA:s dataskyddsramverk (Data Privacy Framework) när mottagaren är certifierad, annars med EU-kommissionens standardavtalsklausuler.",
  en: "Transfers to the US rely on the EU–US Data Privacy Framework where the recipient is certified, otherwise on the European Commission's standard contractual clauses.",
};

/** The platform the app runs on, listed unless the host replaces them (configurePolicy). */
export const DEFAULT_SERVICES: PrivacyService[] = [
  {
    id: "hostup",
    name: "Hostup AB",
    category: "necessary",
    countries: ["SE"],
    purpose: {
      sv: "Driftar servrarna appen körs på: webbservern, databasen och säkerhetskopiorna.",
      en: "Hosts the servers the app runs on: the web server, the database and the backups.",
    },
    data: {
      sv: "Allt som sparas i appen: konto, innehåll du skapar, inställningar och tekniska loggar (IP-adress, tidpunkter).",
      en: "Everything stored in the app: your account, the content you create, settings and technical logs (IP address, times).",
    },
    policyUrl: "https://hostup.se",
  },
  {
    id: "supabase",
    name: "Supabase",
    provider: "Supabase, Inc.",
    category: "analytics",
    countries: ["US"],
    domains: ["supabase.com"],
    purpose: {
      sv: "Telemetri från databasplattformen (Supabase) som appen bygger på: hur plattformen används och mår.",
      en: "Telemetry from the database platform (Supabase) the app is built on: how the platform is used and performs.",
    },
    data: {
      sv: "Tekniska användnings- och prestandadata, utan innehållet du sparar.",
      en: "Technical usage and performance data, without the content you store.",
    },
    transfer: DPF_SCC,
    policyUrl: "https://supabase.com/privacy",
  },
  {
    id: "google-cloud",
    name: "Google Cloud Storage",
    provider: "Google Cloud EMEA Ltd / Google LLC",
    category: "necessary",
    countries: ["EU", "US"],
    domains: ["storage.googleapis.com"],
    purpose: {
      sv: "Lagrar filer du laddar upp till mediebiblioteket och levererar dem via tidsbegränsade länkar.",
      en: "Stores files you upload to the media library and delivers them through time-limited links.",
    },
    data: {
      sv: "Filerna du laddar upp och tekniska loggar om när de hämtas.",
      en: "The files you upload and technical logs of when they are fetched.",
    },
    transfer: DPF_SCC,
    policyUrl: "https://cloud.google.com/privacy",
  },
  {
    id: "firebase",
    name: "Firebase",
    provider: "Google LLC / Google Ireland Ltd",
    category: "analytics",
    countries: ["SE", "EU", "US"],
    domains: ["firebaseio.com", "firebaseinstallations.googleapis.com", "google-analytics.com"],
    purpose: {
      sv: "Apptjänster från Google Firebase, t.ex. notiser och lagring, och Firebase Analytics för användningsstatistik.",
      en: "App services from Google Firebase, such as notifications and storage, and Firebase Analytics for usage statistics.",
    },
    data: {
      sv: "Enhets- och app-id, tekniska uppgifter om enheten och händelser om hur appen används.",
      en: "Device and app ids, technical details about the device and events about how the app is used.",
    },
    transfer: DPF_SCC,
    policyUrl: "https://firebase.google.com/support/privacy",
    storage: [
      {
        name: "_ga, _ga_<id>",
        kind: "cookie",
        purpose: { sv: "Skiljer besökare åt i användningsstatistiken.", en: "Tells visitors apart in the usage statistics." },
        duration: { sv: "2 år", en: "2 years" },
      },
    ],
  },
  {
    id: "mux",
    name: "Mux",
    provider: "Mux, Inc.",
    category: "analytics",
    countries: ["US", "EU"],
    domains: ["stream.mux.com", "image.mux.com", "litix.io"],
    purpose: {
      sv: "Lagrar, konverterar och strömmar video och ljud, och mäter uppspelningen med Mux Data (videoanalys).",
      en: "Stores, transcodes and streams video and audio, and measures playback with Mux Data (video analytics).",
    },
    data: {
      sv: "Videofilerna du laddar upp; vid uppspelning IP-adress, ungefärlig plats, enhet, webbläsare och uppspelningshändelser (start, buffring, fel).",
      en: "The video files you upload; on playback the IP address, approximate location, device, browser and playback events (start, buffering, errors).",
    },
    transfer: DPF_SCC,
    policyUrl: "https://www.mux.com/privacy",
    storage: [
      {
        name: "muxData",
        kind: "cookie",
        purpose: { sv: "Ett anonymt tittar-id för videoanalysen.", en: "An anonymous viewer id for video analytics." },
        duration: { sv: "Enligt Mux villkor", en: "As set by Mux" },
      },
    ],
  },
];

/** What the app itself keeps in the browser: the session, the consent, the user's settings. */
export function defaultStorageItems(): StorageItem[] {
  return [
    {
      name: "sb-…-auth-token",
      kind: "localStorage",
      provider: "Supabase",
      category: "necessary",
      purpose: { sv: "Håller dig inloggad.", en: "Keeps you signed in." },
      duration: { sv: "Tills du loggar ut", en: "Until you sign out" },
    },
    {
      name: namespaced("consent"),
      kind: "localStorage",
      provider: "",
      category: "necessary",
      purpose: { sv: "Ditt val i rutan om cookies.", en: "Your choice in the cookie notice." },
      duration: { sv: "Tills du ändrar det", en: "Until you change it" },
    },
    {
      name: namespaced("…"),
      kind: "localStorage",
      provider: "",
      category: "necessary",
      purpose: { sv: "Språk, tema, layout och andra inställningar du väljer på enheten.", en: "Language, theme, layout and other settings you pick on the device." },
      duration: { sv: "Tills du rensar dem", en: "Until you clear them" },
    },
  ];
}

let hostServices: PrivacyService[] = DEFAULT_SERVICES;
let hostStorage: StorageItem[] | null = null;

/** Replaces the host's own services (the platform) and the app's own storage items. */
export function configurePolicy(next: { services?: PrivacyService[]; storage?: StorageItem[] }): void {
  if (next.services) hostServices = next.services;
  if (next.storage) hostStorage = next.storage;
}

/**
 * Every service: the host's, then each registered app's manifest `services`. An app's service with
 * the same id as an earlier one replaces it, so an app can refine a platform entry.
 */
export function getServices(): ListedService[] {
  const byId = new Map<string, ListedService>();
  for (const service of hostServices) byId.set(service.id, { ...service, appId: null });
  for (const { value, appId } of resolutionsOf(privacyServicesHook)) {
    byId.set(value.id, { ...value, appId, appName: appId ? getInternalApp(appId)?.name : undefined });
  }
  return [...byId.values()];
}

/** The services of one consent category (for the cookie notice). */
export const servicesInCategory = (category: string): ListedService[] => getServices().filter((s) => (s.category || "necessary") === category);

/** Whether the user allows a service (by id): whether they allow its category. Unknown ids aren't allowed. */
export function hasServiceConsent(serviceId: string): boolean {
  const service = getServices().find((s) => s.id === serviceId);
  return !!service && hasConsent(service.category || "necessary");
}

/** `onConsent` for a service's category: starts it once allowed, stops it when taken back. */
export function onServiceConsent(serviceId: string, start: () => void | (() => void)): () => void {
  const service = getServices().find((s) => s.id === serviceId);
  return service ? onConsent(service.category || "necessary", start) : () => {};
}

/** The service's legal basis: its own, else consent for optional categories and contract otherwise. */
export const legalBasisOf = (service: PrivacyService) => service.legalBasis ?? (service.category && service.category !== "necessary" ? "consent" : "contract");

/** Everything kept in the browser: the app's own items, then each service's. */
export function getStorageItems(): StorageItem[] {
  return [
    ...(hostStorage ?? defaultStorageItems()),
    ...getServices().flatMap((s) => (s.storage ?? []).map((item) => ({ ...item, provider: s.name, category: s.category || "necessary" }))),
  ];
}

const EEA = new Set(["AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO", "EU", "EEA"]);

/** Whether a service stores or processes data outside the EU/EEA. */
export const processesOutsideEea = (service: PrivacyService) => service.countries.some((code) => !EEA.has(code.toUpperCase()));

export type PolicyBlock =
  | { kind: "p"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "processors" }
  | { kind: "storage" }
  | { kind: "consent" };

export interface PolicySection {
  id: string;
  heading: string;
  blocks: PolicyBlock[];
}

const PLACEHOLDERS: Record<PolicyLocale, Required<ConsentController>> = {
  sv: {
    name: "[Personuppgiftsansvarigs namn]",
    organizationNumber: "[organisationsnummer]",
    address: "[postadress]",
    email: "[e-postadress]",
    privacyContact: "[kontaktperson för dataskydd]",
  },
  en: {
    name: "[Name of the data controller]",
    organizationNumber: "[company registration number]",
    address: "[postal address]",
    email: "[e-mail address]",
    privacyContact: "[data protection contact]",
  },
};

/** The controller's details with placeholders for anything unset. */
export function controllerDetails(locale: PolicyLocale): Required<ConsentController> {
  const set = getConsentConfig().controller;
  const fallback = PLACEHOLDERS[locale];
  const pick = (key: keyof ConsentController) => set[key]?.trim() || fallback[key];
  return {
    name: pick("name"),
    organizationNumber: pick("organizationNumber"),
    address: pick("address"),
    email: pick("email"),
    privacyContact: set.privacyContact?.trim() || set.email?.trim() || fallback.privacyContact,
  };
}

/** The policy's sections in `locale`. */
export function privacyPolicy(locale: PolicyLocale): PolicySection[] {
  const c = controllerDetails(locale);
  const abroad = getServices().filter(processesOutsideEea).map((s) => s.name);
  return locale === "sv" ? swedish(c, abroad) : english(c, abroad);
}

/** "a, b and c". */
function list(items: string[], and: string): string {
  return items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} ${and} ${items[items.length - 1]}`;
}

function swedish(c: Required<ConsentController>, abroad: string[]): PolicySection[] {
  return [
    {
      id: "controller",
      heading: "Personuppgiftsansvarig",
      blocks: [
        { kind: "p", text: `${c.name} (org.nr ${c.organizationNumber}), ${c.address}, är personuppgiftsansvarig för behandlingen av dina personuppgifter i appen. Du når oss på ${c.email}.` },
        { kind: "p", text: `Frågor om dataskydd kan du ställa till ${c.privacyContact}.` },
      ],
    },
    {
      id: "data",
      heading: "Vilka uppgifter vi behandlar",
      blocks: [
        {
          kind: "list",
          items: [
            "Kontouppgifter: namn, e-postadress och inloggningsuppgifter från den tjänst du loggar in med.",
            "Innehåll du skapar: allt du sparar i appens appar, filer du laddar upp och dina inställningar.",
            "Tekniska uppgifter: IP-adress, enhet, webbläsare, tidpunkter och felloggar som uppstår när du använder appen.",
            "Med ditt samtycke: statistik om hur appen används, telemetri om prestanda och fel samt videoanalys.",
          ],
        },
      ],
    },
    {
      id: "purposes",
      heading: "Varför vi behandlar dem och med vilken rätt",
      blocks: [
        {
          kind: "list",
          items: [
            "För att tillhandahålla appen och ditt konto, lagra ditt innehåll och leverera filer och video: avtal (artikel 6.1 b GDPR).",
            "För säkerhet, felsökning och för att förhindra missbruk: berättigat intresse (artikel 6.1 f).",
            "För statistik, telemetri och videoanalys: ditt samtycke (artikel 6.1 a och lagen om elektronisk kommunikation 9 kap. 28 §). Du kan när som helst ta tillbaka det.",
            "För att uppfylla krav i lag, t.ex. bokföring: rättslig förpliktelse (artikel 6.1 c).",
          ],
        },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies och lagring på din enhet",
      blocks: [
        { kind: "p", text: "Appen sparar uppgifter i din webbläsare (cookies och localStorage). Det som behövs för att appen ska fungera sparas alltid. Allt annat sparas bara om du har sagt ja i rutan om cookies, och du kan ändra ditt val när du vill under Cookie-inställningar." },
        { kind: "consent" },
        { kind: "storage" },
      ],
    },
    {
      id: "processors",
      heading: "Vilka som lagrar och behandlar uppgifterna",
      blocks: [
        { kind: "p", text: "Vi anlitar följande leverantörer som personuppgiftsbiträden. De får bara behandla uppgifterna för vår räkning och enligt våra instruktioner, enligt personuppgiftsbiträdesavtal." },
        { kind: "processors" },
      ],
    },
    {
      id: "transfers",
      heading: "Överföring utanför EU/EES",
      blocks: [
        {
          kind: "p",
          text: abroad.length
            ? `Några leverantörer (${list(abroad, "och")}) kan behandla uppgifter utanför EU/EES, t.ex. i USA; var står i tabellen ovan. Överföringen sker med stöd av ett beslut om adekvat skyddsnivå, som EU:s och USA:s dataskyddsramverk (Data Privacy Framework) när mottagaren är certifierad, annars med EU-kommissionens standardavtalsklausuler och kompletterande skyddsåtgärder.`
            : "Alla uppgifter lagras och behandlas inom EU/EES.",
        },
      ],
    },
    {
      id: "retention",
      heading: "Hur länge vi sparar uppgifterna",
      blocks: [
        {
          kind: "list",
          items: [
            "Konto och innehåll: så länge du har ditt konto. När du tar bort kontot raderas uppgifterna inom [30] dagar och ur säkerhetskopior inom [90] dagar.",
            "Tekniska loggar: högst [12] månader.",
            "Statistik och telemetri: högst [14] månader, därefter bara i sammanställd form.",
            "Uppgifter som lag kräver att vi sparar: så länge lagen kräver.",
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "Dina rättigheter",
      blocks: [
        { kind: "p", text: "Enligt dataskyddsförordningen (GDPR) har du rätt att:" },
        {
          kind: "list",
          items: [
            "få veta vilka uppgifter vi har om dig och få en kopia av dem (tillgång),",
            "få felaktiga uppgifter rättade,",
            "få uppgifter raderade,",
            "begränsa behandlingen,",
            "få ut uppgifter du gett oss i ett maskinläsbart format (dataportabilitet),",
            "invända mot behandling som grundar sig på berättigat intresse,",
            "när som helst ta tillbaka ett samtycke, utan att det påverkar behandlingen innan dess.",
          ],
        },
        { kind: "p", text: `Kontakta oss på ${c.email} för att använda dina rättigheter. Vi svarar inom en månad.` },
      ],
    },
    {
      id: "complaints",
      heading: "Klagomål",
      blocks: [
        { kind: "p", text: "Om du anser att vi behandlar dina uppgifter fel kan du klaga hos Integritetsskyddsmyndigheten (IMY), Box 8114, 104 20 Stockholm, imy.se, eller hos tillsynsmyndigheten i landet där du bor eller arbetar." },
      ],
    },
    {
      id: "security",
      heading: "Säkerhet",
      blocks: [
        { kind: "p", text: "Uppgifterna skickas krypterat (HTTPS), åtkomst till dem styrs per konto i databasen och bara behörig personal kommer åt servrarna." },
      ],
    },
    {
      id: "changes",
      heading: "Ändringar",
      blocks: [
        { kind: "p", text: "Ändras policyn på ett sätt som påverkar ditt samtycke frågar vi dig igen. Datumet för den senaste ändringen står överst." },
      ],
    },
  ];
}

function english(c: Required<ConsentController>, abroad: string[]): PolicySection[] {
  return [
    {
      id: "controller",
      heading: "Data controller",
      blocks: [
        { kind: "p", text: `${c.name} (reg. no. ${c.organizationNumber}), ${c.address}, is the controller of your personal data in the app. You can reach us at ${c.email}.` },
        { kind: "p", text: `Questions about data protection can go to ${c.privacyContact}.` },
      ],
    },
    {
      id: "data",
      heading: "What data we process",
      blocks: [
        {
          kind: "list",
          items: [
            "Account details: name, e-mail address and sign-in details from the service you sign in with.",
            "Content you create: everything you save in the app's apps, files you upload and your settings.",
            "Technical data: IP address, device, browser, times and error logs from using the app.",
            "With your consent: statistics on how the app is used, performance and error telemetry, and video analytics.",
          ],
        },
      ],
    },
    {
      id: "purposes",
      heading: "Why we process it, and on what legal basis",
      blocks: [
        {
          kind: "list",
          items: [
            "To provide the app and your account, store your content and deliver files and video: contract (GDPR article 6(1)(b)).",
            "For security, troubleshooting and preventing abuse: legitimate interest (article 6(1)(f)).",
            "For statistics, telemetry and video analytics: your consent (article 6(1)(a) and the ePrivacy rules on storing information on your device). You can withdraw it at any time.",
            "To meet legal requirements, such as bookkeeping: legal obligation (article 6(1)(c)).",
          ],
        },
      ],
    },
    {
      id: "cookies",
      heading: "Cookies and storage on your device",
      blocks: [
        { kind: "p", text: "The app stores data in your browser (cookies and localStorage). What the app needs to work is always stored. Anything else is only stored if you said yes in the cookie notice, and you can change your choice whenever you like under Cookie settings." },
        { kind: "consent" },
        { kind: "storage" },
      ],
    },
    {
      id: "processors",
      heading: "Who stores and processes the data",
      blocks: [
        { kind: "p", text: "We use the following providers as processors. They may only process the data on our behalf and on our instructions, under data processing agreements." },
        { kind: "processors" },
      ],
    },
    {
      id: "transfers",
      heading: "Transfers outside the EU/EEA",
      blocks: [
        {
          kind: "p",
          text: abroad.length
            ? `Some providers (${list(abroad, "and")}) may process data outside the EU/EEA, for example in the United States; the table above says where. Those transfers rely on an adequacy decision, such as the EU–US Data Privacy Framework where the recipient is certified, otherwise on the European Commission's standard contractual clauses with supplementary measures.`
            : "All data is stored and processed within the EU/EEA.",
        },
      ],
    },
    {
      id: "retention",
      heading: "How long we keep the data",
      blocks: [
        {
          kind: "list",
          items: [
            "Account and content: for as long as you have your account. When you delete it, the data is erased within [30] days, and from backups within [90] days.",
            "Technical logs: at most [12] months.",
            "Statistics and telemetry: at most [14] months, after that only in aggregated form.",
            "Data the law requires us to keep: for as long as the law requires.",
          ],
        },
      ],
    },
    {
      id: "rights",
      heading: "Your rights",
      blocks: [
        { kind: "p", text: "Under the General Data Protection Regulation (GDPR) you have the right to:" },
        {
          kind: "list",
          items: [
            "know what data we hold about you and get a copy of it (access),",
            "have incorrect data corrected,",
            "have data erased,",
            "restrict processing,",
            "receive the data you gave us in a machine-readable format (data portability),",
            "object to processing based on legitimate interest,",
            "withdraw a consent at any time, without affecting the processing before that.",
          ],
        },
        { kind: "p", text: `Contact us at ${c.email} to use your rights. We answer within one month.` },
      ],
    },
    {
      id: "complaints",
      heading: "Complaints",
      blocks: [
        { kind: "p", text: "If you think we process your data wrongly, you can complain to the Swedish Authority for Privacy Protection (IMY), Box 8114, SE-104 20 Stockholm, imy.se, or to the supervisory authority where you live or work." },
      ],
    },
    {
      id: "security",
      heading: "Security",
      blocks: [
        { kind: "p", text: "Data is sent encrypted (HTTPS), access to it is controlled per account in the database, and only authorized staff can reach the servers." },
      ],
    },
    {
      id: "changes",
      heading: "Changes",
      blocks: [
        { kind: "p", text: "If the policy changes in a way that affects your consent, we ask you again. The date of the latest change is shown at the top." },
      ],
    },
  ];
}
